"""Grid-search how much the quiz trusts the population prior vs. each answer.

    .venv/bin/python scripts/tune_scales.py k32
"""
import itertools
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from taste.evaluate import ROOT, run  # noqa: E402

if __name__ == "__main__":
    model = sys.argv[1] if len(sys.argv) > 1 else "k32"
    rows = []
    for ps, ns in itertools.product([1, 2, 4], [0.5, 1, 2]):
        _, s = run(model, "val", 500, ["info_gain_ps"], ps, ns, workers=6, verbose=False)
        s = s.set_index(["strategy", "q"])
        r = dict(model=model, prior=ps, noise=ns)
        for q in [10, 20, 40]:
            r[f"liked@{q}"] = s.loc[("info_gain_ps", q), "liked"]
            r[f"order@{q}"] = s.loc[("info_gain_ps", q), "order"]
        r["liked@all"] = s.loc[("all_known", -1), "liked"]
        r["order@all"] = s.loc[("all_known", -1), "order"]
        r["rmse@all"] = s.loc[("all_known", -1), "rmse"]
        rows.append(r)
        print(pd.DataFrame([r]).round(3).to_string(index=False, header=len(rows) == 1), flush=True)
    (ROOT / "results").mkdir(exist_ok=True)
    pd.DataFrame(rows).to_csv(ROOT / "results" / f"tune_scales_{model}.csv", index=False)
