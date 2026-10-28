"""Reconstroi data/operacional/alarm_daily.csv e alarm_tag_summary.csv a
partir do log de alarmes (AlarmLog) do FactoryTalk View SE, filtrado para o
periodo do projeto SOBRAL (mesma janela dos logs de tendencia).

Formato (reverse-engineered): mesmo esquema de cabecalho autodescritivo dos
arquivos de tendencia (DLGLOG), mas com um layout de registro diferente,
874 bytes, campos de texto de largura fixa:

  TimeStmp(24) MilliTime(3) TransType(6) AlarmType(1) SrcArea(80)
  TagName(255) TagValue(20) TagType(1) ThreshVal(20) ThreshNum(1)
  ThreshLbl(21) Severity(1) UserID(38) Dscrptn(132) SrcComputr(15)
  UserName(255)

Os campos TransType/SrcArea/UserID trazem um digito espurio antes do texto
real (motivo desconhecido) -- por isso o parser usa TagName e Dscrptn, que
decodificam limpos. Dscrptn e uma linha legivel por humanos:
"MM/DD/YYYY  H:MM:SS  <Verbo> Tag ALARMAS\\<TAG>  ...  ON/OFF".

Peculiaridades conhecidas dos dados (tratadas abaixo):
  - O verbo "OutAlm" aparece truncado como "OutAl" (5 caracteres) no texto
    original do log -- nao e bug do parser.
  - Ha registros malformados (ex.: a tag CHILER) sem data/hora/verbo
    legiveis em Dscrptn; sao mantidos sob o verbo sintetico "unknown",
    datados pelo nome do arquivo, em vez de descartados.
  - Cerca de 11% dos registros no periodo trazem uma data de 2007 cravada
    (resquicio de um slot de disco reaproveitado pelo logger original);
    qualquer registro cuja data caia fora da janela abaixo e descartado.

Uso:
    python scripts/parse_alarms.py [--limit N]
"""

import argparse
import re
import struct
from collections import defaultdict
from datetime import date
from pathlib import Path

ALARM_DIR = Path(r"D:/computador-sta/programa/RSView Enterprise/SE/AlarmLog")
OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "operacional"
WINDOW_START = date(2020, 10, 24)
WINDOW_END = date(2026, 10, 23)

RECORD_SIZE = 874
FIELDS = {
    "TimeStmp": (1, 24), "MilliTime": (25, 3), "TransType": (28, 6),
    "AlarmType": (34, 1), "SrcArea": (35, 80), "TagName": (115, 255),
    "TagValue": (370, 20), "TagType": (390, 1), "ThreshVal": (391, 20),
    "ThreshNum": (411, 1), "ThreshLbl": (412, 21), "Severity": (433, 1),
    "UserID": (434, 38), "Dscrptn": (472, 132), "SrcComputr": (604, 15),
    "UserName": (619, 255),
}

DSCRPTN_RE = re.compile(
    r"^(\d{1,2})/(\d{1,2})/(\d{4})\s+\d{1,2}:\d{2}:\d{2}\s+(\S+)\s+Tag\s+(\S+)"
)
VERB_MAP = {"inalm": "inalm", "outal": "outal", "outalm": "outal", "acked": "acked"}


def parse_header(data: bytes):
    offset = 32
    fields = []
    while True:
        chunk = data[offset:offset + 32]
        if len(chunk) < 32:
            break
        name = chunk[0:11].split(b"\x00")[0]
        if not name or not all(32 <= b < 127 for b in name):
            break
        foffset = struct.unpack_from("<I", chunk, 12)[0]
        fsize = chunk[16]
        fields.append((name.decode("ascii"), foffset, fsize))
        offset += 32
    return fields, offset


def decode_field(rec: bytes, name: str) -> str:
    off, size = FIELDS[name]
    return rec[off:off + size].split(b"\x00")[0].decode("latin1", errors="replace").strip()


def strip_tag(raw: str) -> str:
    return raw.split("\\", 1)[1] if "\\" in raw else raw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="process only the first N day-files (debug)")
    args = ap.parse_args()

    files = sorted(
        f for f in ALARM_DIR.glob("*AL.DAT")
        if WINDOW_START.strftime("%Y%m%d") <= f.name[:8] <= WINDOW_END.strftime("%Y%m%d")
    )
    if args.limit:
        files = files[: args.limit]
    print(f"found {len(files)} AL files in window")

    daily_counts = defaultdict(int)  # (date, tag, verb) -> count
    errors = []
    dropped_stale = 0
    n_events = 0

    for i, fpath in enumerate(files):
        file_date = f"{fpath.name[0:4]}-{fpath.name[4:6]}-{fpath.name[6:8]}"
        data = fpath.read_bytes()
        if not data:
            continue
        try:
            _, header_end = parse_header(data)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{fpath.name}: header parse error: {e}")
            continue

        n = (len(data) - header_end) // RECORD_SIZE
        for r in range(n):
            base = header_end + r * RECORD_SIZE
            rec = data[base:base + RECORD_SIZE]

            tag_raw = decode_field(rec, "TagName")
            tag = strip_tag(tag_raw) if tag_raw else None
            dscrptn = decode_field(rec, "Dscrptn")

            m = DSCRPTN_RE.match(dscrptn)
            if not m:
                # malformed record (e.g. bare "ALARMAS\CHILER" with no
                # readable date/verb) -- keep it, don't discard real activity
                if tag:
                    daily_counts[(file_date, tag, "unknown")] += 1
                    n_events += 1
                else:
                    errors.append(f"{fpath.name}#{r}: no tag, no parseable Dscrptn")
                continue

            mm, dd, yyyy, verb_raw, tag_from_text = m.groups()
            try:
                rec_date = date(int(yyyy), int(mm), int(dd))
            except ValueError:
                errors.append(f"{fpath.name}#{r}: bad date in Dscrptn {dscrptn!r}")
                continue
            if not (WINDOW_START <= rec_date <= WINDOW_END):
                dropped_stale += 1
                continue

            verb = VERB_MAP.get(verb_raw.lower(), "unknown")
            final_tag = strip_tag(tag_from_text) or tag or "UNKNOWN"
            daily_counts[(rec_date.isoformat(), final_tag, verb)] += 1
            n_events += 1

        if (i + 1) % 200 == 0 or (i + 1) == len(files):
            print(f"processed {i + 1}/{len(files)} files ({file_date})")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    daily_path = OUT_DIR / "alarm_daily.csv"
    with open(daily_path, "w", encoding="utf-8", newline="") as f:
        f.write("date,tag,verb,count\n")
        for (d, tag, verb), count in sorted(daily_counts.items()):
            f.write(f"{d},{tag},{verb},{count}\n")
    print(f"wrote {len(daily_counts)} rows to {daily_path}")

    summary = defaultdict(lambda: {"total_inalm": 0, "first_date": None, "last_date": None})
    for (d, tag, verb), count in daily_counts.items():
        s = summary[tag]
        if verb == "inalm":
            s["total_inalm"] += count
        if s["first_date"] is None or d < s["first_date"]:
            s["first_date"] = d
        if s["last_date"] is None or d > s["last_date"]:
            s["last_date"] = d

    summary_path = OUT_DIR / "alarm_tag_summary.csv"
    rows = sorted(summary.items(), key=lambda kv: kv[1]["total_inalm"], reverse=True)
    with open(summary_path, "w", encoding="utf-8", newline="") as f:
        f.write("tag,total_inalm,first_date,last_date,sample_description\n")
        for tag, s in rows:
            f.write(f"{tag},{s['total_inalm']},{s['first_date']},{s['last_date']},{tag} ON\n")
    print(f"wrote {len(rows)} rows to {summary_path}")

    print(f"{n_events} events kept, {dropped_stale} dropped as out-of-window (stale date), "
          f"{len(errors)} warnings")
    for e in errors[:20]:
        print(" -", e)


if __name__ == "__main__":
    main()
