import base64
import json
import struct
import unittest

from taste.quick import quick_bundle

N, K, POOL = 50, 4, 10
FILMS = {"title": [f"F{i}" for i in range(N)], "year": list(range(1950, 1950 + N)), "imdb": list(range(100, 100 + N))}
VEC = bytes((i * 7) % 256 for i in range(N * K))
BIAS = struct.pack(f"<{N}f", *[i / 10 for i in range(N)])
FLAGS = bytes(i % 2 for i in range(N))
POSTERS = [f"p{i}.jpg" for i in range(N)]


class Quick(unittest.TestCase):
    def test_is_the_first_pool_rows_of_everything(self):
        q = quick_bundle(FILMS, VEC, BIAS, FLAGS, POSTERS, POOL, K)
        self.assertEqual(q["films"]["title"], FILMS["title"][:POOL])
        self.assertEqual(q["films"]["imdb"], FILMS["imdb"][:POOL])
        self.assertEqual(base64.b64decode(q["vec"]), VEC[:POOL * K])
        self.assertEqual(struct.unpack(f"<{POOL}f", base64.b64decode(q["bias"])), struct.unpack(f"<{N}f", BIAS)[:POOL])
        self.assertEqual(base64.b64decode(q["flags"]), FLAGS[:POOL])
        self.assertEqual(q["posters"], POSTERS[:POOL])
        json.dumps(q)

    def test_columns_that_disagree_are_refused(self):
        with self.assertRaises(ValueError):
            quick_bundle(FILMS, VEC[:-1], BIAS, FLAGS, POSTERS, POOL, K)
        with self.assertRaises(ValueError):
            quick_bundle(FILMS, VEC, BIAS, FLAGS, POSTERS[:-1], POOL, K)
        with self.assertRaises(ValueError):
            quick_bundle(FILMS, VEC, BIAS, FLAGS, POSTERS, N + 1, K)


if __name__ == "__main__":
    unittest.main()
