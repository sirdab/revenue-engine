#!/usr/bin/env python3
"""Report wording drift between the locale dictionaries.

Key parity, plural categories and placeholders are already enforced by
src/lib/i18n/locale-parity.test.ts. What no test can decide is WORDING: the
same English label rendered two different ways in Arabic is sometimes correct
(Arabic marks definiteness and gender, and one English word can be two parts
of speech) and sometimes a feature called two different things. This prints
the candidates so a human can tell those apart.

Run after the Arabic review to confirm the list shrank:

    python3 scripts/i18n/drift.py            # full report
    python3 scripts/i18n/drift.py --count    # just the number, for a diff
"""
import collections
import json
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
I18N = os.path.join(REPO, "artifacts/web/src/lib/i18n")

# Long strings are sentences; two sentences differing is not glossary drift.
MAX_LABEL = 40


def load(locale):
    with open(os.path.join(I18N, f"{locale}.json"), encoding="utf-8") as f:
        return json.load(f)


def drift(en, ar):
    by_label = collections.defaultdict(lambda: collections.defaultdict(list))
    for key, value in en.items():
        if key not in ar:
            continue  # parity test's problem, not ours
        label = value.strip().lower()
        if not 2 <= len(label) <= MAX_LABEL:
            continue
        by_label[label][ar[key].strip()].append(key)
    return {lbl: rs for lbl, rs in by_label.items() if len(rs) > 1}


def untranslated(en, ar):
    """Values with Latin letters and no Arabic script — usually proper nouns."""
    arabic = re.compile(r"[؀-ۿ]")
    out = []
    for key, value in ar.items():
        body = re.sub(r"\{\w+\}", "", value).strip()
        if not body or arabic.search(value) or not re.search(r"[A-Za-z]", body):
            continue
        out.append((key, value))
    return out


def main():
    en, ar = load("en"), load("ar")
    d = drift(en, ar)

    if "--count" in sys.argv:
        print(len(d))
        return

    print(f"en.json {len(en)} keys, ar.json {len(ar)} keys\n")

    left = untranslated(en, ar)
    print(f"## Arabic values with no Arabic script ({len(left)})")
    print("Expected to be proper nouns only.\n")
    for key, value in left:
        print(f"  {key} = {value!r}")

    print(f"\n## English labels rendered more than one way ({len(d)})\n")
    for label, renderings in sorted(d.items()):
        total = sum(len(ks) for ks in renderings.values())
        print(f'### "{label}" — {len(renderings)} renderings, {total} keys')
        for arabic, keys in sorted(renderings.items(), key=lambda kv: -len(kv[1])):
            print(f"  {arabic}")
            for key in keys[:4]:
                print(f"      {key}")
            if len(keys) > 4:
                print(f"      … +{len(keys) - 4}")
        print()


if __name__ == "__main__":
    main()
