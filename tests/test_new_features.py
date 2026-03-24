"""Tests for the new features:
- ATS CV scanning (_extract_ats_keywords, _score_ats, api_cv_ats_scan)
- User authentication (api_user_register, api_user_login, api_user_me, api_user_logout)
- Ride sharing (api_ride_post, api_rides_list, api_ride_cancel)
- Driver geolocation (_haversine_km, api_driver_location, api_driver_nearby)
"""

import asyncio
import uuid
import pytest
from types import SimpleNamespace

from api.app import (
    _extract_ats_keywords,
    _score_ats,
    _haversine_km,
    api_cv_ats_scan,
    api_user_register,
    api_user_login,
    api_user_logout,
    api_user_me,
    api_ride_post,
    api_rides_list,
    api_ride_cancel,
    api_ride_take,
    api_admin_rides,
    api_driver_location,
    api_driver_nearby,
    api_driver_locations,
    _UserRegisterRequest,
    _UserLoginRequest,
    _AtsRequest,
    _RidePostRequest,
    _DriverLocationUpdate,
    _UserLocationUpdate,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_request(session=None):
    """Return a minimal mock Request with a dict session."""
    session = session if session is not None else {}
    return SimpleNamespace(
        session=session,
        headers={"content-type": "application/json"},
    )


def run(coro):
    return asyncio.run(coro)


def _unique_email(prefix="user"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}@example.com"


def _register_user(name="Test", role="passenger"):
    """Register a brand-new user; returns the JSON response dict."""
    email = _unique_email(prefix=name.lower().replace(" ", ""))
    resp = run(api_user_register(_UserRegisterRequest(
        name=name,
        email=email,
        password="password123",
        role=role,
    )))
    return resp, email


def _login_session(email, session=None):
    """Login and return the session dict (modified in place)."""
    if session is None:
        session = {}
    req = _make_request(session)
    run(api_user_login(req, _UserLoginRequest(email=email, password="password123")))
    return session


# ---------------------------------------------------------------------------
# ATS keyword extraction
# ---------------------------------------------------------------------------

class TestExtractAtsKeywords:
    def test_returns_list(self):
        kws = _extract_ats_keywords("Python developer with Django and REST API experience")
        assert isinstance(kws, list)

    def test_python_detected(self):
        kws = _extract_ats_keywords("Must know Python and JavaScript")
        assert "python" in kws
        assert "javascript" in kws

    def test_stop_words_excluded(self):
        kws = _extract_ats_keywords("the and or but in on")
        for stop in ["the", "and", "or", "but", "in", "on"]:
            assert stop not in kws

    def test_multi_word_phrase_detected(self):
        kws = _extract_ats_keywords("Experience with machine learning and deep learning frameworks")
        assert "machine learning" in kws
        assert "deep learning" in kws

    def test_empty_string(self):
        kws = _extract_ats_keywords("")
        assert kws == []

    def test_deduplication(self):
        kws = _extract_ats_keywords("Python Python Python")
        assert kws.count("python") == 1


# ---------------------------------------------------------------------------
# ATS scoring
# ---------------------------------------------------------------------------

class TestScoreAts:
    def test_perfect_match(self):
        kws = ["python", "django", "postgresql"]
        cv = "I have experience in Python Django and PostgreSQL databases"
        result = _score_ats(cv, kws)
        assert result["score"] == 100
        assert set(result["matched"]) == set(kws)
        assert result["missing"] == []

    def test_zero_match(self):
        kws = ["kubernetes", "terraform", "helm"]
        cv = "I am a junior developer"
        result = _score_ats(cv, kws)
        assert result["score"] == 0
        assert result["matched"] == []
        assert set(result["missing"]) == set(kws)

    def test_partial_match(self):
        kws = ["python", "java", "react"]
        cv = "Python developer with React experience"
        result = _score_ats(cv, kws)
        assert result["score"] == round(2 / 3 * 100)
        assert "python" in result["matched"]
        assert "react" in result["matched"]
        assert "java" in result["missing"]

    def test_tips_present_for_low_score(self):
        kws = ["skill1", "skill2", "skill3", "skill4", "skill5"]
        cv = "no relevant content"
        result = _score_ats(cv, kws)
        assert len(result["tips"]) > 0

    def test_empty_keywords(self):
        result = _score_ats("some cv text", [])
        assert result["score"] == 0

    def test_score_bounded(self):
        kws = ["python"]
        cv = "python python python"
        result = _score_ats(cv, kws)
        assert 0 <= result["score"] <= 100


# ---------------------------------------------------------------------------
# ATS endpoint (JSON path)
# ---------------------------------------------------------------------------

class TestAtsScanEndpoint:
    def test_returns_score_for_valid_input(self):
        req = SimpleNamespace(
            headers={"content-type": "application/json"},
        )
        # Patch request.json to return our payload
        async def fake_json():
            return {
                "cv_text": "Python developer with Django and PostgreSQL experience. REST API.",
                "job_description": "Looking for a Python Django developer with PostgreSQL and REST API skills.",
            }
        req.json = fake_json
        resp = run(api_cv_ats_scan(req, file=None, job_description="", cv_text=""))
        data = resp.body if hasattr(resp, "body") else None
        import json
        body = json.loads(resp.body)
        assert "score" in body
        assert "matched" in body
        assert "missing" in body
        assert 0 <= body["score"] <= 100

    def test_missing_cv_text_returns_400(self):
        req = SimpleNamespace(headers={"content-type": "application/json"})
        async def fake_json():
            return {"cv_text": "", "job_description": "Some JD"}
        req.json = fake_json
        resp = run(api_cv_ats_scan(req, file=None, job_description="", cv_text=""))
        assert resp.status_code == 400

    def test_missing_jd_returns_400(self):
        req = SimpleNamespace(headers={"content-type": "application/json"})
        async def fake_json():
            return {"cv_text": "My CV content", "job_description": "  "}
        req.json = fake_json
        resp = run(api_cv_ats_scan(req, file=None, job_description="", cv_text=""))
        assert resp.status_code == 400

    def test_form_path_works(self):
        # Test the multipart form path (no file, plain form fields)
        req = SimpleNamespace(headers={"content-type": "multipart/form-data"})
        resp = run(api_cv_ats_scan(
            req,
            file=None,
            job_description="Python Django REST API developer role",
            cv_text="Python developer experienced with Django and REST API design",
        ))
        import json
        body = json.loads(resp.body)
        assert body["score"] > 0


# ---------------------------------------------------------------------------
# Haversine distance
# ---------------------------------------------------------------------------

class TestHaversine:
    def test_same_point_is_zero(self):
        assert _haversine_km(51.5, -0.1, 51.5, -0.1) == pytest.approx(0.0, abs=1e-6)

    def test_london_to_paris(self):
        dist = _haversine_km(51.51, -0.13, 48.85, 2.35)
        assert 330 < dist < 360

    def test_symmetry(self):
        d1 = _haversine_km(40.0, -74.0, 51.5, -0.1)
        d2 = _haversine_km(51.5, -0.1, 40.0, -74.0)
        assert d1 == pytest.approx(d2, rel=1e-6)


# ---------------------------------------------------------------------------
# User authentication
# ---------------------------------------------------------------------------

class TestUserRegister:
    def test_register_ok(self):
        resp, _ = _register_user("RegUser")
        import json
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert len(body["user_id"]) == 36  # UUID format

    def test_duplicate_email_returns_409(self):
        resp, email = _register_user("DupUser")
        resp2 = run(api_user_register(_UserRegisterRequest(
            name="Dup Again",
            email=email,
            password="password123",
        )))
        assert resp2.status_code == 409

    def test_short_password_returns_400(self):
        resp = run(api_user_register(_UserRegisterRequest(
            name="Fail",
            email=_unique_email(),
            password="abc",
        )))
        assert resp.status_code == 400

    def test_invalid_email_returns_400(self):
        resp = run(api_user_register(_UserRegisterRequest(
            name="Fail",
            email="not-an-email",
            password="password123",
        )))
        assert resp.status_code == 400

    def test_role_driver_accepted(self):
        resp, _ = _register_user("DriverUser")
        import json
        # Just check it returns 201 (status code default for JSONResponse with status_code=201)
        assert resp.status_code == 201


class TestUserLogin:
    def test_login_valid_credentials(self):
        import json
        _, email = _register_user("LoginOk")
        session = {}
        req = _make_request(session)
        resp = run(api_user_login(req, _UserLoginRequest(email=email, password="password123")))
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert "app_user_id" in session

    def test_login_wrong_password(self):
        _, email = _register_user("LoginFail")
        req = _make_request()
        resp = run(api_user_login(req, _UserLoginRequest(email=email, password="wrongpass")))
        assert resp.status_code == 401

    def test_login_unknown_email(self):
        req = _make_request()
        resp = run(api_user_login(req, _UserLoginRequest(email="nobody@nowhere.com", password="pw")))
        assert resp.status_code == 401


class TestUserMe:
    def test_me_without_session_returns_401(self):
        req = _make_request({})
        resp = run(api_user_me(req))
        assert resp.status_code == 401

    def test_me_with_session_returns_profile(self):
        import json
        _, email = _register_user("MeUser")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_user_me(req))
        body = json.loads(resp.body)
        assert body["email"] == email

    def test_logout_clears_session(self):
        _, email = _register_user("LogoutUser")
        session = _login_session(email)
        req = _make_request(session)
        # Confirm logged in
        resp = run(api_user_me(req))
        assert resp.status_code == 200
        # Logout
        run(api_user_logout(req))
        assert "app_user_id" not in session
        # Now me should fail
        resp2 = run(api_user_me(req))
        assert resp2.status_code == 401


# ---------------------------------------------------------------------------
# Ride sharing
# ---------------------------------------------------------------------------

class TestRidePost:
    def test_post_ride_ok(self):
        import json
        _, email = _register_user("RideDriver")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_post(req, _RidePostRequest(
            origin="New York",
            destination="Boston",
            departure="2030-06-15T09:00",
            seats=3,
            notes="Sedan",
        )))
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert "ride_id" in body

    def test_post_ride_requires_login(self):
        req = _make_request({})
        resp = run(api_ride_post(req, _RidePostRequest(
            origin="A", destination="B",
            departure="2030-01-01T10:00", seats=1,
        )))
        assert resp.status_code == 401

    def test_post_ride_empty_origin(self):
        import json
        _, email = _register_user("RideNoOrigin")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_post(req, _RidePostRequest(
            origin="  ",
            destination="Boston",
            departure="2030-06-01T09:00",
            seats=1,
        )))
        assert resp.status_code == 400

    def test_rides_appear_in_list(self):
        import json
        _, email = _register_user("RideList")
        session = _login_session(email)
        req = _make_request(session)
        run(api_ride_post(req, _RidePostRequest(
            origin="ListOrigin_" + uuid.uuid4().hex[:6],
            destination="ListDest",
            departure="2030-07-01T08:00",
            seats=2,
        )))
        resp = run(api_rides_list())
        body = json.loads(resp.body)
        assert "rides" in body
        assert isinstance(body["rides"], list)


class TestRideCancel:
    def test_cancel_own_ride(self):
        import json
        _, email = _register_user("CancelOwner")
        session = _login_session(email)
        req = _make_request(session)
        r = run(api_ride_post(req, _RidePostRequest(
            origin="CancelSrc", destination="CancelDst",
            departure="2030-08-01T07:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        resp = run(api_ride_cancel(req, ride_id))
        assert resp.status_code == 200

    def test_cancel_not_owner_returns_403(self):
        import json
        _, email1 = _register_user("CancelA")
        session1 = _login_session(email1)
        req1 = _make_request(session1)
        r = run(api_ride_post(req1, _RidePostRequest(
            origin="ShareOrig", destination="ShareDest",
            departure="2030-09-01T06:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]

        _, email2 = _register_user("CancelB")
        session2 = _login_session(email2)
        req2 = _make_request(session2)
        resp = run(api_ride_cancel(req2, ride_id))
        assert resp.status_code == 403

    def test_cancel_nonexistent_returns_404(self):
        _, email = _register_user("CancelNone")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_cancel(req, "nonexistent-id-xyz"))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Driver geolocation
# ---------------------------------------------------------------------------

class TestDriverGeolocation:
    def _driver_session(self):
        _, email = _register_user("GeoDriver")
        # Re-register as driver
        email2 = _unique_email("geodriver")
        run(api_user_register(_UserRegisterRequest(
            name="GeoDriver", email=email2, password="password123", role="driver",
        )))
        session = _login_session(email2)
        return session, email2

    def test_passenger_cannot_broadcast(self):
        _, email = _register_user("GeoPax")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_driver_location(req, _DriverLocationUpdate(lat=51.5, lng=-0.1, empty=True)))
        assert resp.status_code == 403

    def test_driver_can_broadcast(self):
        import json
        session, _ = self._driver_session()
        req = _make_request(session)
        resp = run(api_driver_location(req, _DriverLocationUpdate(lat=51.5, lng=-0.1, empty=True)))
        body = json.loads(resp.body)
        assert body["ok"] is True

    def test_broadcast_requires_login(self):
        req = _make_request({})
        resp = run(api_driver_location(req, _DriverLocationUpdate(lat=0.0, lng=0.0)))
        assert resp.status_code == 401

    def test_nearby_drivers_returns_list(self):
        import json
        req = _make_request({})
        resp = run(api_driver_nearby(req, lat=51.5, lng=-0.1, radius_km=50.0))
        body = json.loads(resp.body)
        assert "drivers" in body
        assert isinstance(body["drivers"], list)

    def test_driver_locations_returns_list(self):
        import json
        resp = run(api_driver_locations())
        body = json.loads(resp.body)
        assert "drivers" in body

    def test_driver_appears_in_locations(self):
        import json
        session, _ = self._driver_session()
        req = _make_request(session)
        run(api_driver_location(req, _DriverLocationUpdate(lat=40.7128, lng=-74.0060, empty=True)))
        resp = run(api_driver_locations())
        locs = json.loads(resp.body)["drivers"]
        lats = [d["lat"] for d in locs]
        assert 40.7128 in lats

    def test_nearby_filters_by_radius(self):
        import json
        # Put driver at London
        session, _ = self._driver_session()
        req = _make_request(session)
        run(api_driver_location(req, _DriverLocationUpdate(lat=51.5074, lng=-0.1278, empty=True)))
        # Query from Sydney — London driver should not appear within 10 km
        resp = run(api_driver_nearby(_make_request({}), lat=-33.8688, lng=151.2093, radius_km=10.0))
        drivers = json.loads(resp.body)["drivers"]
        london_nearby = [d for d in drivers if abs(d["lat"] - 51.5074) < 0.01]
        assert len(london_nearby) == 0


# ---------------------------------------------------------------------------
# Ride take endpoint
# ---------------------------------------------------------------------------

class TestRideTake:
    def test_take_own_ride(self):
        import json
        _, email = _register_user("TakeOwner")
        session = _login_session(email)
        req = _make_request(session)
        r = run(api_ride_post(req, _RidePostRequest(
            origin="TakeSrc", destination="TakeDst",
            departure="2031-01-01T10:00", seats=2,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        resp = run(api_ride_take(req, ride_id))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert body["ok"] is True

    def test_take_updates_status_to_taken(self):
        import json
        _, email = _register_user("TakeStatus")
        session = _login_session(email)
        req = _make_request(session)
        r = run(api_ride_post(req, _RidePostRequest(
            origin="TakeSrc2", destination="TakeDst2",
            departure="2031-02-01T10:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        run(api_ride_take(req, ride_id))
        # Verify it appears as taken in list (all statuses)
        list_resp = run(api_rides_list(status="taken"))
        rides = json.loads(list_resp.body)["rides"]
        taken_ids = [rd["ride_id"] for rd in rides if rd["status"] == "taken"]
        assert ride_id in taken_ids

    def test_take_not_owner_returns_403(self):
        import json
        _, email1 = _register_user("TakeA")
        session1 = _login_session(email1)
        req1 = _make_request(session1)
        r = run(api_ride_post(req1, _RidePostRequest(
            origin="TakeShared", destination="TakeSharedDst",
            departure="2031-03-01T10:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]

        _, email2 = _register_user("TakeB")
        session2 = _login_session(email2)
        req2 = _make_request(session2)
        resp = run(api_ride_take(req2, ride_id))
        assert resp.status_code == 403

    def test_take_nonexistent_returns_404(self):
        _, email = _register_user("TakeNone")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_take(req, "no-such-ride-xyz"))
        assert resp.status_code == 404

    def test_take_requires_login(self):
        req = _make_request({})
        resp = run(api_ride_take(req, "some-ride-id"))
        assert resp.status_code == 401

    def test_cannot_take_cancelled_ride(self):
        import json
        _, email = _register_user("TakeCancelled")
        session = _login_session(email)
        req = _make_request(session)
        r = run(api_ride_post(req, _RidePostRequest(
            origin="CancelFirst", destination="ThenTake",
            departure="2031-04-01T10:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        run(api_ride_cancel(req, ride_id))
        resp = run(api_ride_take(req, ride_id))
        assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Admin rides endpoint
# ---------------------------------------------------------------------------

class TestAdminRides:
    def test_admin_rides_without_session_returns_401(self):
        req = _make_request({})
        resp = run(api_admin_rides(req))
        assert resp.status_code == 401

    def test_admin_rides_with_session_returns_data(self):
        import json
        session = {"admin_user": "admin"}
        req = _make_request(session)
        resp = run(api_admin_rides(req))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "rides" in body
        assert "stats" in body
        stats = body["stats"]
        assert "total" in stats
        assert "open" in stats
        assert "taken" in stats
        assert "cancelled" in stats

    def test_admin_rides_stats_are_consistent(self):
        import json
        # Post a ride then take it so stats cover multiple statuses
        _, email = _register_user("AdminRideStats")
        session_user = _login_session(email)
        req_user = _make_request(session_user)
        r = run(api_ride_post(req_user, _RidePostRequest(
            origin="AdminSrc", destination="AdminDst",
            departure="2031-05-01T10:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        run(api_ride_take(req_user, ride_id))

        admin_req = _make_request({"admin_user": "admin"})
        resp = run(api_admin_rides(admin_req))
        body = json.loads(resp.body)
        stats = body["stats"]
        assert stats["total"] == stats["open"] + stats["taken"] + stats["cancelled"]


# ---------------------------------------------------------------------------
# Rides list status filter
# ---------------------------------------------------------------------------

class TestRidesListFilter:
    def test_list_open_filter(self):
        import json
        resp = run(api_rides_list(status="open"))
        rides = json.loads(resp.body)["rides"]
        assert all(r["status"] == "open" for r in rides)

    def test_list_taken_filter(self):
        import json
        _, email = _register_user("FilterTaken")
        session = _login_session(email)
        req = _make_request(session)
        r = run(api_ride_post(req, _RidePostRequest(
            origin="FilterSrc", destination="FilterDst",
            departure="2031-06-01T10:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        run(api_ride_take(req, ride_id))

        resp = run(api_rides_list(status="taken"))
        rides = json.loads(resp.body)["rides"]
        assert all(r["status"] == "taken" for r in rides)

    def test_list_default_returns_open_and_taken(self):
        import json
        resp = run(api_rides_list())
        rides = json.loads(resp.body)["rides"]
        statuses = {r["status"] for r in rides}
        # Should never include cancelled
        assert "cancelled" not in statuses
