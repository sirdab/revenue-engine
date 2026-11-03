import json, subprocess, tempfile, os, sys
S = os.path.dirname(os.path.abspath(__file__))
# Derived from this file's location for the same reason as in codemod.ts:
# the tooling is committed, so it must work in any checkout.
REPO = os.path.abspath(os.path.join(S, "..", ".."))
LOGIN = os.path.join(REPO, "artifacts/login")

def run(file, strings=(), edits=(), keys=()):
    """strings: list of (en, key, ar) or (en, key) for reuse. edits: list of (old, new)."""
    def ent(x):
        return {"en": x[0], "key": x[1], **({"ar": x[2]} if len(x) > 2 else {})}
    job = {"file": file, "strings": [ent(s) for s in strings], "keys": [ent(k) for k in keys], "edits": [list(e) for e in edits]}
    fd, p = tempfile.mkstemp(suffix=".json", dir=S)
    with os.fdopen(fd, "w") as f: json.dump(job, f, ensure_ascii=False)
    print(f"## {file}")
    r = subprocess.run(["npx", "tsx", os.path.join(S, "codemod.ts"), "apply", p], cwd=LOGIN, capture_output=True, text=True)
    print(r.stdout.strip()); 
    if r.stderr.strip(): print(r.stderr.strip()[:2000])
    os.unlink(p)

def edit(file, *pairs):
    """Plain exact edits without touching dictionaries."""
    p = os.path.join(LOGIN, file)
    s = open(p).read()
    for old, new in pairs:
        if s.count(old) != 1:
            print(f"EDIT PROBLEM in {file}: count={s.count(old)} for {old[:70]!r}")
            continue
        s = s.replace(old, new)
    open(p, "w").write(s)

def keys(*entries):
    run("src/lib/i18n/en.json", keys=entries)

def plural(base, en_one, en_other, ar_zero, ar_one, ar_two, ar_few, ar_many, ar_other):
    """Entries for one plural message: English one/other, Arabic all six."""
    return [(en_one, base + "#one", ar_one), (en_other, base + "#other", ar_other),
            (en_other, base + "#zero", ar_zero), (en_other, base + "#two", ar_two),
            (en_other, base + "#few", ar_few), (en_other, base + "#many", ar_many)]
