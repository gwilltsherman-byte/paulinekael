import unittest

from scripts.calibrate_match import quiz_checkpoints, reliability


class MatchCalibrationTest(unittest.TestCase):
    def test_caps_and_skips_do_not_get_mislabelled_as_ratings(self):
        class Session:
            def __init__(self):
                self.answers = {}

            def answer(self, film, rating):
                self.answers[film] = rating

        def first_unasked(session, pool):
            return next(i for i in pool if i not in session.answers)

        pool = list(range(8))
        known = {1: 2, 3: 3, 5: 5, 6: 4}
        stages = quiz_checkpoints(Session(), pool, known, first_unasked, str, (0, 3, 5), max_asks=7)
        self.assertEqual([(n, len(s.answers)) for n, s in stages], [(0, 0), (3, 6)])

    def test_reliability_includes_exact_bucket_boundaries_and_extremes(self):
        bins, brier = reliability([0, .8, .85, 1.0], [0, 1, 0, 1])
        self.assertEqual(bins[0][0], 1)
        self.assertEqual(bins[-2][0], 2)
        self.assertEqual(bins[-2][2], 1)
        self.assertEqual(bins[-1], [1, 1.0, 1])
        self.assertAlmostEqual(brier, (.2 ** 2 + .85 ** 2) / 4)
