"""Reconstroi data/operacional/sta_daily.csv a partir dos logs binarios de
tendencia (DLGLOG) do FactoryTalk View SE do projeto SOBRAL.

Formato (reverse-engineered): cada arquivo binario comeca com um cabecalho
autodescritivo de campos (32 bytes cada, a partir do offset 32): nome (11
bytes), tipo (1 byte), offset do campo no registro (uint32 LE), tamanho do
campo (1 byte). Depois do cabecalho vem uma sequencia de registros de
tamanho fixo.

  - Arquivo "(Tagname).DAT": mapeia indice de tag -> nome da tag.
  - Arquivo "(Float).DAT": um registro por leitura analogica (39 bytes:
    marker, reserved, date, time, millitm, indice da tag, valor f64,
    status, marker2, internal).

So' 20 tags foram logadas no periodo observado (confirmado inspecionando o
Tagname.DAT mais recente) -- nao ha mais pontos analogicos a adicionar a
partir dessa fonte.

Uso:
    python scripts/parse_trend.py [--limit N]

Sem --limit, processa todos os arquivos encontrados em TREND_DIR. Grava o
resultado em data/operacional/sta_daily.csv (sobrescrevendo).
"""

import argparse
import re
import struct
import sys
from pathlib import Path

import numpy as np
import pandas as pd

TREND_DIR = Path(
    r"D:/computador-sta/programa/RSView Enterprise/SE/HMI Projects/SOBRAL/DLGLOG/TREND"
)
OUT_CSV = Path(__file__).resolve().parent.parent / "data" / "operacional" / "sta_daily.csv"

EXPECTED_TAGNAME_FIELDS = ["Tagname", "TTagIndex", "TagType", "TagDataTyp"]
EXPECTED_FLOAT_FIELDS = ["Date", "Time", "Millitm", "TagIndex", "Value", "Status", "Marker", "Internal"]

FLOAT_DTYPE = np.dtype([
    ("marker", "u1"),
    ("reserved", "u1"),
    ("date", "S8"),
    ("time", "S8"),
    ("millitm", "S3"),
    ("tagidx", "S5"),
    ("value", "<f8"),
    ("status", "u1"),
    ("marker2", "u1"),
    ("internal", "S3"),
])
assert FLOAT_DTYPE.itemsize == 39


def parse_header(data: bytes):
    offset = 32
    fields = []
    while True:
        chunk = data[offset:offset + 32]
        if len(chunk) < 32:
            break
        name_raw = chunk[0:11]
        name = name_raw.split(b"\x00")[0]
        if not name or not all(32 <= b < 127 for b in name):
            break
        foffset = struct.unpack_from("<I", chunk, 12)[0]
        fsize = chunk[16]
        fields.append((name.decode("ascii"), foffset, fsize))
        offset += 32
    return fields, offset


def load_tagmap(path: Path):
    data = path.read_bytes()
    fields, header_end = parse_header(data)
    names = [f[0] for f in fields]
    if names != EXPECTED_TAGNAME_FIELDS:
        raise ValueError(f"unexpected tagname schema: {names}")
    rec_size = fields[-1][1] + fields[-1][2]
    n_records = (len(data) - header_end) // rec_size
    idx_to_name = {}
    pos = header_end
    for _ in range(n_records):
        rec = data[pos:pos + rec_size]
        name = rec[1:256].split(b"\x00")[0].decode("latin1").strip()
        idx_txt = rec[256:262].decode("ascii", errors="replace").strip()
        try:
            idx = int(idx_txt)
        except ValueError:
            pos += rec_size
            continue
        idx_to_name[idx] = name
        pos += rec_size
    return idx_to_name


def load_float_df(path: Path):
    data = path.read_bytes()
    fields, header_end = parse_header(data)
    names = [f[0] for f in fields]
    if names != EXPECTED_FLOAT_FIELDS:
        raise ValueError(f"unexpected float schema: {names}")
    rec_size = fields[-1][1] + fields[-1][2]
    if rec_size != FLOAT_DTYPE.itemsize:
        raise ValueError(f"unexpected float record size: {rec_size}")
    n_records = (len(data) - header_end) // rec_size
    arr = np.frombuffer(data, dtype=FLOAT_DTYPE, count=n_records, offset=header_end)
    df = pd.DataFrame({
        "date": arr["date"].astype("U8"),
        "time": arr["time"].astype("U8"),
        "tagidx_raw": arr["tagidx"].astype("U5"),
        "value": arr["value"],
        "status": arr["status"],
    })
    df["tagidx"] = pd.to_numeric(df["tagidx_raw"].str.strip(), errors="coerce")
    df = df.dropna(subset=["tagidx"])
    df["tagidx"] = df["tagidx"].astype(int)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="process only the first N day-files (debug)")
    ap.add_argument("--out", type=Path, default=OUT_CSV)
    args = ap.parse_args()

    float_files = sorted(TREND_DIR.glob("* (Float).DAT"))
    if args.limit:
        float_files = float_files[: args.limit]
    print(f"found {len(float_files)} float files")

    all_rows = []
    errors = []
    last_good_tagmap = {}

    for i, fpath in enumerate(float_files):
        m = re.match(r"(\d{4}) (\d{2}) (\d{2}) \d{4} \(Float\)\.DAT", fpath.name)
        file_date = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else fpath.name

        tagname_path = fpath.with_name(fpath.name.replace("(Float)", "(Tagname)"))
        try:
            if tagname_path.exists():
                last_good_tagmap = load_tagmap(tagname_path)
                tagmap = last_good_tagmap
            else:
                tagmap = last_good_tagmap
                errors.append(f"{file_date}: missing tagname file, reused previous map")
        except Exception as e:  # noqa: BLE001
            tagmap = last_good_tagmap
            errors.append(f"{file_date}: tagname parse error: {e}")

        try:
            df = load_float_df(fpath)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{file_date}: float parse error: {e}")
            continue

        df = df[df["status"] != 0x55]  # drop logger-start placeholder records
        df["tagname"] = df["tagidx"].map(tagmap)
        df = df.dropna(subset=["tagname"])
        if df.empty:
            continue

        grouped = df.groupby("tagname")["value"].agg(["count", "mean", "min", "max"]).reset_index()
        grouped["date"] = file_date
        idx_last = df.groupby("tagname")["time"].idxmax()
        last_vals = df.loc[idx_last, ["tagname", "value"]].rename(columns={"value": "last_value"})
        grouped = grouped.merge(last_vals, on="tagname", how="left")
        all_rows.append(grouped)

        if (i + 1) % 100 == 0 or (i + 1) == len(float_files):
            print(f"processed {i + 1}/{len(float_files)} files ({file_date})")

    if not all_rows:
        print("no data aggregated")
        sys.exit(1)

    result = pd.concat(all_rows, ignore_index=True)
    result["tag"] = result["tagname"].str.replace(r"^TREND\\", "", regex=True)
    result["count"] = result["count"].astype(int)
    result["mean"] = result["mean"].round(4)
    result["min"] = result["min"].round(4)
    result["max"] = result["max"].round(4)
    result["last_value"] = result["last_value"].round(4)
    result = result[["date", "tag", "count", "mean", "min", "max", "last_value"]]
    result = result.sort_values(["date", "tag"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(args.out, index=False)
    print(f"wrote {len(result)} rows to {args.out}")
    print(f"{len(errors)} warnings/errors")
    for e in errors[:20]:
        print(" -", e)


if __name__ == "__main__":
    main()
