"""Personalised "have you seen it?" probabilities for the quiz's question pool.

Treat each person's seen / not-seen pattern over the pool films as a vector with
population mean p and covariance C (estimated from training users). After some
answers, the conditional mean given the answered films,
    p_j + C_jO C_OO^-1 (x_O - p_O),
estimates the chance they've seen each remaining film. Both "seen" and
"haven't seen" answers move it.
"""
import numpy as np
import scipy.sparse as sp

from .data import OUT

POOL = 2000


def build(pool=POOL):
    u = np.load(OUT / "train_u.npy")
    i = np.load(OUT / "train_i.npy")
    keep = i < pool
    nu = u.max() + 1
    X = sp.csr_matrix((np.ones(keep.sum(), np.float32), (u[keep], i[keep])), shape=(nu, pool))
    p = np.asarray(X.mean(0)).ravel()
    C = (X.T @ X).toarray() / nu - np.outer(p, p)
    np.savez(OUT / "seen.npz", p=p, C=C)
    print(f"saved seen model for {pool} films")


class SeenModel:
    def __init__(self, ridge=0.02):
        z = np.load(OUT / "seen.npz")
        self.p, self.C = z["p"].astype(np.float64), z["C"].astype(np.float64)
        self.ridge = ridge

    def prob(self, answers):
        """P(seen) for every pool film given {item: label or None} answers so far."""
        O = [j for j in answers if j < len(self.p)]
        if not O:
            return self.p
        x = np.array([answers[j] is not None for j in O], float)
        COO = self.C[np.ix_(O, O)] + self.ridge * np.eye(len(O))
        est = self.p + self.C[:, O] @ np.linalg.solve(COO, x - self.p[O])
        return np.clip(est, 0.002, 0.998)


if __name__ == "__main__":
    build()
