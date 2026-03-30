"""Tests for the new features:
- ATS CV scanning (_extract_ats_keywords, _score_ats, api_cv_ats_scan)
- User authentication (api_user_register, api_user_login, api_user_me, api_user_logout)
- Ride sharing (api_ride_post, api_rides_list, api_ride_cancel)
- Driver geolocation (_haversine_km, api_driver_location, api_driver_nearby)
- User dashboard (api_user_dashboard)
- Direct messaging (api_dm_list_conversations, api_dm_start_conversation, api_dm_send, etc.)
"""

import asyncio
import os
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
    api_change_password,
    api_ride_post,
    api_rides_list,
    api_ride_cancel,
    api_ride_take,
    api_admin_rides,
    api_driver_location,
    api_driver_nearby,
    api_driver_locations,
    api_calculate_fare,
    api_shared_fare,
    _UserRegisterRequest,
    _UserLoginRequest,
    _ChangePasswordRequest,
    _AtsRequest,
    _RidePostRequest,
    _DriverLocationUpdate,
    _UserLocationUpdate,
    api_user_update_profile_details,
    api_get_notifications,
    api_mark_notification_read,
    api_mark_all_notifications_read,
    api_admin_driver_approve,
    _create_notification,
    _UserProfileDetailsUpdate,
    _DriverApproveRequest,
    api_get_ride_chat,
    api_ride_chat_inbox,
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


def _grant_posting_permission(user_id):
    """Directly set can_post_properties=1 for a user (simulates admin approval)."""
    from api.app import _get_db, _db_lock, USE_POSTGRES
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE app_users SET can_post_properties=1 WHERE user_id=%s", (user_id,))
            else:
                conn.execute("UPDATE app_users SET can_post_properties=1 WHERE user_id=?", (user_id,))
            conn.commit()
        finally:
            conn.close()


def _grant_driver_role(user_id):
    """Directly set role='driver' for a user (simulates admin-approved driver application)."""
    from api.app import _get_db, _db_lock, USE_POSTGRES
    with _db_lock:
        conn = _get_db()
        try:
            if USE_POSTGRES:
                cur = conn.cursor()
                cur.execute("UPDATE app_users SET role='driver' WHERE user_id=%s", (user_id,))
            else:
                conn.execute("UPDATE app_users SET role='driver' WHERE user_id=?", (user_id,))
            conn.commit()
        finally:
            conn.close()


def _register_driver(name="Driver"):
    """Register a user and immediately grant them the driver role. Returns (resp, email)."""
    import json
    resp, email = _register_user(name, role="passenger")
    user_id = json.loads(resp.body)["user_id"]
    _grant_driver_role(user_id)
    return resp, email


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


class TestChangePassword:
    def test_change_password_ok(self):
        import json
        _, email = _register_user("PwChangeOk")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_change_password(req, _ChangePasswordRequest(
            current_password="password123",
            new_password="newpassword456",
        )))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert body["ok"] is True

    def test_change_password_wrong_current(self):
        _, email = _register_user("PwChangeBad")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_change_password(req, _ChangePasswordRequest(
            current_password="wrongpassword",
            new_password="newpassword456",
        )))
        assert resp.status_code == 401

    def test_change_password_too_short(self):
        _, email = _register_user("PwChangeShort")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_change_password(req, _ChangePasswordRequest(
            current_password="password123",
            new_password="abc",
        )))
        assert resp.status_code == 400

    def test_change_password_unauthenticated(self):
        req = _make_request({})
        resp = run(api_change_password(req, _ChangePasswordRequest(
            current_password="password123",
            new_password="newpassword456",
        )))
        assert resp.status_code == 401

    def test_changed_password_works_for_login(self):
        """After a successful password change, the new password must work for login."""
        _, email = _register_user("PwChangeLogin")
        session = _login_session(email)
        req = _make_request(session)
        run(api_change_password(req, _ChangePasswordRequest(
            current_password="password123",
            new_password="supersecret99",
        )))
        # Login with new password should succeed
        new_session = {}
        new_req = _make_request(new_session)
        from api.app import _UserLoginRequest as ULR
        resp = run(api_user_login(new_req, ULR(email=email, password="supersecret99")))
        assert resp.status_code == 200
        assert "app_user_id" in new_session

        # Login with old password should fail
        old_req = _make_request({})
        resp2 = run(api_user_login(old_req, ULR(email=email, password="password123")))
        assert resp2.status_code == 401


# ---------------------------------------------------------------------------
# Ride sharing
# ---------------------------------------------------------------------------

class TestRidePost:
    def test_post_ride_ok(self):
        import json
        _, email = _register_driver("RideDriver")
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

    def test_post_ride_non_driver_returns_403(self):
        """Non-driver (passenger) users must be blocked from posting rides."""
        import json
        _, email = _register_user("RidePassenger")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_post(req, _RidePostRequest(
            origin="Airport",
            destination="City",
            departure="2030-06-01T09:00",
            seats=1,
        )))
        assert resp.status_code == 403

    def test_post_ride_empty_origin(self):
        import json
        _, email = _register_driver("RideNoOrigin")
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
        _, email = _register_driver("RideList")
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

    def test_post_ride_with_fare(self):
        import json
        _, email = _register_driver("FareDriver")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_post(req, _RidePostRequest(
            origin="JFK Airport",
            destination="Manhattan",
            departure="2030-08-01T10:00",
            seats=2,
            fare=25.50,
            origin_lat=40.6413,
            origin_lng=-73.7781,
            dest_lat=40.7128,
            dest_lng=-74.0060,
        )))
        body = json.loads(resp.body)
        assert body["ok"] is True
        ride_id = body["ride_id"]
        # Verify fare appears in list
        list_resp = run(api_rides_list())
        rides = json.loads(list_resp.body)["rides"]
        posted = [r for r in rides if r["ride_id"] == ride_id]
        assert len(posted) == 1
        assert posted[0]["fare"] == 25.50


class TestCalculateFare:
    """Tests for the fare calculation endpoint."""

    def test_calculate_fare_returns_fare(self):
        import json
        # London to Paris ~341 km
        resp = run(api_calculate_fare(
            origin_lat=51.5074, origin_lng=-0.1278,
            dest_lat=48.8566, dest_lng=2.3522,
        ))
        body = json.loads(resp.body)
        assert "fare" in body
        assert "dist_km" in body
        assert body["fare"] > 0
        assert body["dist_km"] > 300

    def test_calculate_fare_same_point(self):
        import json
        resp = run(api_calculate_fare(
            origin_lat=0.0, origin_lng=0.0,
            dest_lat=0.0, dest_lng=0.0,
        ))
        body = json.loads(resp.body)
        assert body["fare"] == 0.0
        assert body["dist_km"] == 0.0


class TestSharedFare:
    """Tests for the shared-ride fare calculator endpoint."""

    def test_full_vehicle_returns_total_fare(self):
        import json
        resp = run(api_shared_fare(total_fare=40.0, total_seats=4, booked_seats=4))
        body = json.loads(resp.body)
        assert body["amount_owed"] == 40.0
        assert body["is_full_vehicle"] is True
        assert body["per_seat_cost"] == 10.0

    def test_single_seat_shared_cost(self):
        import json
        resp = run(api_shared_fare(total_fare=40.0, total_seats=4, booked_seats=1))
        body = json.loads(resp.body)
        assert body["amount_owed"] == 10.0
        assert body["is_full_vehicle"] is False
        assert body["per_seat_cost"] == 10.0

    def test_two_seats_of_four(self):
        import json
        resp = run(api_shared_fare(total_fare=40.0, total_seats=4, booked_seats=2))
        body = json.loads(resp.body)
        assert body["amount_owed"] == 20.0
        assert body["is_full_vehicle"] is False

    def test_invalid_booked_seats_returns_400(self):
        resp = run(api_shared_fare(total_fare=40.0, total_seats=4, booked_seats=0))
        assert resp.status_code == 400

    def test_booked_exceeds_total_returns_400(self):
        resp = run(api_shared_fare(total_fare=40.0, total_seats=2, booked_seats=5))
        assert resp.status_code == 400

    def test_zero_fare_returns_zero_cost(self):
        import json
        resp = run(api_shared_fare(total_fare=0.0, total_seats=3, booked_seats=1))
        body = json.loads(resp.body)
        assert body["amount_owed"] == 0.0

    def test_driver_only_seat_is_full_vehicle(self):
        import json
        resp = run(api_shared_fare(total_fare=20.0, total_seats=1, booked_seats=1))
        body = json.loads(resp.body)
        assert body["is_full_vehicle"] is True
        assert body["amount_owed"] == 20.0


class TestRideCancel:
    def test_cancel_own_ride(self):
        import json
        _, email = _register_driver("CancelOwner")
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
        _, email1 = _register_driver("CancelA")
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
        """Register a driver user, submit and approve a driver application, return session."""
        from api.app import api_driver_apply, _DriverApplyRequest, _DriverApproveRequest
        import json
        email2 = _unique_email("geodriver")
        reg_resp = run(api_user_register(_UserRegisterRequest(
            name="GeoDriver", email=email2, password="password123", role="driver",
        )))
        user_id = json.loads(reg_resp.body)["user_id"]
        session = _login_session(email2)

        # Submit and approve a driver application so the driver can broadcast
        apply_req = _make_request({"app_user_id": user_id})
        apply_resp = run(api_driver_apply(apply_req, _DriverApplyRequest(
            vehicle_make="Toyota", vehicle_model="Camry",
            vehicle_year=2022, vehicle_color="White", license_plate="GEO001",
        )))
        app_id = json.loads(apply_resp.body).get("app_id")
        if app_id:
            admin_req = _make_request({"admin_user": "admin"})
            run(api_admin_driver_approve(admin_req, app_id, _DriverApproveRequest(approved=True)))

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

    def test_driver_not_notified_by_broadcast(self):
        """The broadcasting driver and other drivers must not receive driver_nearby."""
        import asyncio as _asyncio
        from unittest.mock import patch, AsyncMock
        import api.app as app_module

        # Register a broadcasting driver, a second driver, and a passenger
        _, driver_email = _register_user("BcastDriver", role="driver")
        _, driver2_email = _register_user("OtherDriver", role="driver")
        _, pax_email = _register_user("BcastPax", role="passenger")

        driver_session = _login_session(driver_email)
        driver2_session = _login_session(driver2_email)
        pax_session = _login_session(pax_email)

        driver_id  = driver_session["app_user_id"]
        driver2_id = driver2_session["app_user_id"]
        pax_id     = pax_session["app_user_id"]

        emitted_rooms = []

        async def _run():
            with app_module._socket_user_lock:
                app_module._sid_to_user["bcast-driver-sid"]  = driver_id
                app_module._user_to_sid[driver_id]           = "bcast-driver-sid"
                app_module._sid_to_user["bcast-driver2-sid"] = driver2_id
                app_module._user_to_sid[driver2_id]          = "bcast-driver2-sid"
                app_module._sid_to_user["bcast-pax-sid"]     = pax_id
                app_module._user_to_sid[pax_id]              = "bcast-pax-sid"

            async def mock_emit(event, data=None, room=None):
                if event == "driver_nearby":
                    emitted_rooms.append(room)

            req = _make_request(driver_session)
            with patch.object(app_module.sio, "emit", side_effect=mock_emit):
                await api_driver_location(
                    req, _DriverLocationUpdate(lat=0.0, lng=0.0, empty=True)
                )
                # Yield to allow the ensure_future'd _notify() coroutine to run
                await _asyncio.sleep(0.05)

            with app_module._socket_user_lock:
                app_module._sid_to_user.pop("bcast-driver-sid",  None)
                app_module._user_to_sid.pop(driver_id,           None)
                app_module._sid_to_user.pop("bcast-driver2-sid", None)
                app_module._user_to_sid.pop(driver2_id,          None)
                app_module._sid_to_user.pop("bcast-pax-sid",     None)
                app_module._user_to_sid.pop(pax_id,              None)

        _asyncio.run(_run())

        assert "bcast-driver-sid"  not in emitted_rooms, \
            "Broadcasting driver must not receive driver_nearby notification"
        assert "bcast-driver2-sid" not in emitted_rooms, \
            "Other drivers must not receive driver_nearby notification"


# ---------------------------------------------------------------------------
# Ride take endpoint
# ---------------------------------------------------------------------------

class TestRideTake:
    def test_take_own_ride(self):
        import json
        _, email = _register_driver("TakeOwner")
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
        _, email = _register_driver("TakeStatus")
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
        _, email1 = _register_driver("TakeA")
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
        _, email = _register_driver("TakeCancelled")
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
        _, email = _register_driver("AdminRideStats")
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
        _, email = _register_driver("FilterTaken")
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


# ---------------------------------------------------------------------------
# Ride chat socket event handlers
# ---------------------------------------------------------------------------

class TestRideChatSocket:
    """Tests for the Socket.IO ride live-chat event handlers."""

    def test_join_ride_chat_emits_joined(self):
        """on_join_ride_chat should enter the ride room and emit ride_chat_joined."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append((evt, data, room)))
            with patch.object(app_module.sio, "emit", mock_emit), \
                 patch.object(app_module.sio, "enter_room"):
                await app_module.on_join_ride_chat("test-sid-join", {
                    "ride_id": ride_id,
                    "name": "Alice",
                })

        _asyncio.run(_run())
        joined_events = [e for e in emitted if e[0] == "ride_chat_joined"]
        assert len(joined_events) == 1
        assert joined_events[0][1]["ride_id"] == ride_id

    def test_join_ride_chat_missing_ride_id_is_noop(self):
        """on_join_ride_chat with no ride_id should not emit anything."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append(evt))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_join_ride_chat("test-sid-noop", {})

        _asyncio.run(_run())
        assert emitted == []

    def test_ride_chat_message_broadcast(self):
        """on_ride_chat_message should broadcast message to the ride room."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append((evt, data, room)))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_ride_chat_message("sender-sid", {
                    "ride_id": ride_id,
                    "name":    "Bob",
                    "text":    "Hello, anyone there?",
                })

        _asyncio.run(_run())
        msgs = [e for e in emitted if e[0] == "ride_chat_message"]
        # First message is the passenger's, second is the auto-response prompt.
        assert len(msgs) == 2
        payload = msgs[0][1]
        assert payload["ride_id"] == ride_id
        assert payload["name"]    == "Bob"
        assert payload["text"]    == "Hello, anyone there?"
        assert msgs[0][2]         == f"ride_chat_{ride_id}"
        # Verify auto-response was emitted as the second message.
        auto = msgs[1][1]
        assert auto["name"] == "System"
        assert "location" in auto["text"].lower()
        assert msgs[1][2] == f"ride_chat_{ride_id}"

    def test_ride_chat_message_empty_text_ignored(self):
        """on_ride_chat_message should not broadcast empty or whitespace messages."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append(evt))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_ride_chat_message("sender-sid", {
                    "ride_id": ride_id,
                    "name":    "Carol",
                    "text":    "   ",
                })

        _asyncio.run(_run())
        assert emitted == []

    def test_ride_chat_message_truncated_at_500(self):
        """Text over 500 chars must be truncated to 500."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        long_text = "x" * 600
        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append((evt, data, room)))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_ride_chat_message("sender-sid", {
                    "ride_id": ride_id,
                    "name":    "Dave",
                    "text":    long_text,
                })

        _asyncio.run(_run())
        msgs = [e for e in emitted if e[0] == "ride_chat_message"]
        # First message is the passenger's (truncated), second is the auto-response.
        assert len(msgs) == 2
        assert len(msgs[0][1]["text"]) == 500

    def test_leave_ride_chat(self):
        """on_leave_ride_chat should call sio.leave_room for the given ride."""
        import asyncio as _asyncio
        from unittest.mock import patch, MagicMock
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        left_rooms = []

        async def _run():
            with patch.object(app_module.sio, "leave_room",
                              side_effect=lambda sid, room: left_rooms.append(room)):
                await app_module.on_leave_ride_chat("test-sid-leave", {"ride_id": ride_id})

        _asyncio.run(_run())
        assert f"ride_chat_{ride_id}" in left_rooms

    def test_leave_ride_chat_missing_ride_id_is_noop(self):
        """on_leave_ride_chat with no ride_id should not call leave_room."""
        import asyncio as _asyncio
        from unittest.mock import patch
        import api.app as app_module

        left_rooms = []

        async def _run():
            with patch.object(app_module.sio, "leave_room",
                              side_effect=lambda sid, room: left_rooms.append(room)):
                await app_module.on_leave_ride_chat("test-sid", {})

        _asyncio.run(_run())
        assert left_rooms == []

    def test_ride_chat_message_media_image_accepted(self):
        """on_ride_chat_message should broadcast image media type."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append((evt, data, room)))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_ride_chat_message("sender-sid", {
                    "ride_id":    ride_id,
                    "name":       "Eve",
                    "text":       "",
                    "media_type": "image",
                    "media_data": "data:image/png;base64,abc123",
                })

        _asyncio.run(_run())
        msgs = [e for e in emitted if e[0] == "ride_chat_message"]
        assert len(msgs) == 1
        assert msgs[0][1]["media_type"] == "image"

    def test_ride_chat_message_invalid_media_type_stripped(self):
        """on_ride_chat_message should strip unknown media_type values."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append((evt, data, room)))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_ride_chat_message("sender-sid", {
                    "ride_id":    ride_id,
                    "name":       "Frank",
                    "text":       "hi",
                    "media_type": "video",   # not allowed
                    "media_data": "blob123",
                })

        _asyncio.run(_run())
        msgs = [e for e in emitted if e[0] == "ride_chat_message"]
        # First message is the passenger's (with stripped media_type),
        # second is the auto-response prompt.
        assert len(msgs) == 2
        assert msgs[0][1]["media_type"] is None

    def test_ride_chat_message_location_accepted(self):
        """on_ride_chat_message should broadcast location media type with coordinates."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        ride_id = str(uuid.uuid4())
        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append((evt, data, room)))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_ride_chat_message("sender-sid", {
                    "ride_id":    ride_id,
                    "name":       "Grace",
                    "text":       "",
                    "media_type": "location",
                    "lat":        -1.2921,
                    "lng":        36.8219,
                })

        _asyncio.run(_run())
        msgs = [e for e in emitted if e[0] == "ride_chat_message"]
        assert len(msgs) == 1
        assert msgs[0][1]["media_type"] == "location"
        assert msgs[0][1]["lat"] == pytest.approx(-1.2921)
        assert msgs[0][1]["lng"] == pytest.approx(36.8219)


# ===========================================================================
# Ride Chat Messages API
# ===========================================================================

class TestRideChatMessages:
    """Tests for /api/rides/{ride_id}/chat and /api/rides/chat/inbox."""

    def test_get_chat_messages_requires_login(self):
        from api.app import api_get_ride_chat
        ride_id = str(uuid.uuid4())
        req = _make_request({})
        resp = run(api_get_ride_chat(req, ride_id))
        assert resp.status_code == 401

    def test_get_chat_messages_empty_for_new_ride(self):
        import json
        from api.app import api_get_ride_chat
        # Register + login
        resp_reg, email = _register_user(name="ChatHistUser")
        session = _login_session(email)
        ride_id = str(uuid.uuid4())
        req = _make_request(session)
        resp = run(api_get_ride_chat(req, ride_id))
        assert resp.status_code == 200
        assert json.loads(resp.body)["messages"] == []

    def test_get_chat_inbox_requires_login(self):
        from api.app import api_ride_chat_inbox
        req = _make_request({})
        resp = run(api_ride_chat_inbox(req))
        assert resp.status_code == 401

    def test_get_chat_inbox_empty_for_new_user(self):
        import json
        from api.app import api_ride_chat_inbox
        resp_reg, email = _register_user(name="InboxUser")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_chat_inbox(req))
        assert resp.status_code == 200
        assert json.loads(resp.body)["conversations"] == []


# ===========================================================================
# Magic Link (passwordless)
# ===========================================================================

class TestMagicLink:
    """Tests for /api/auth/magic_link and /api/auth/magic_link/verify."""

    def test_magic_link_invalid_email_returns_400(self):
        from api.app import api_magic_link_request, _MagicLinkRequest
        resp = run(api_magic_link_request(_MagicLinkRequest(email="not-an-email")))
        assert resp.status_code == 400

    def test_magic_link_unknown_email_returns_ok_without_token(self):
        """Should not reveal whether address is registered."""
        from api.app import api_magic_link_request, _MagicLinkRequest
        resp = run(api_magic_link_request(_MagicLinkRequest(email="nobody_xyz@nowhere.com")))
        body = resp.body
        import json
        data = json.loads(body)
        assert data.get("ok") is True
        # Token must NOT be returned for unregistered emails
        assert "token" not in data

    def test_magic_link_known_email_returns_token(self):
        _, email = _register_user("MagicUser")
        from api.app import api_magic_link_request, _MagicLinkRequest
        import json
        resp = run(api_magic_link_request(_MagicLinkRequest(email=email)))
        data = json.loads(resp.body)
        assert data.get("ok") is True
        assert data.get("token")

    def test_magic_link_verify_valid_token(self):
        _, email = _register_user("MagicVerify")
        from api.app import api_magic_link_request, api_magic_link_verify, _MagicLinkRequest
        import json
        token_resp = run(api_magic_link_request(_MagicLinkRequest(email=email)))
        token = json.loads(token_resp.body)["token"]

        # Build a minimal request-like object with a JSON body
        class _Req:
            session = {}
            async def json(self):
                return {"token": token}

        resp = run(api_magic_link_verify(_Req()))
        data = json.loads(resp.body)
        assert data.get("ok") is True
        assert data.get("email") == email

    def test_magic_link_verify_invalid_token_returns_401(self):
        from api.app import api_magic_link_verify
        import json

        class _Req:
            session = {}
            async def json(self):
                return {"token": "invalid-token-xyz"}

        resp = run(api_magic_link_verify(_Req()))
        assert resp.status_code == 401

    def test_magic_link_single_use(self):
        """Token should be consumed and fail on second use."""
        _, email = _register_user("MagicSingleUse")
        from api.app import api_magic_link_request, api_magic_link_verify, _MagicLinkRequest
        import json
        token_resp = run(api_magic_link_request(_MagicLinkRequest(email=email)))
        token = json.loads(token_resp.body)["token"]

        class _Req:
            session = {}
            async def json(self):
                return {"token": token}

        run(api_magic_link_verify(_Req()))       # first use — ok
        resp2 = run(api_magic_link_verify(_Req()))  # second use — should fail
        assert resp2.status_code == 401


# ===========================================================================
# Driver Application
# ===========================================================================

class TestDriverApplication:
    """Tests for driver role application and admin approval."""

    def _apply(self, user_id):
        from api.app import api_driver_apply, _DriverApplyRequest
        req = _make_request({"app_user_id": user_id})
        body = _DriverApplyRequest(
            vehicle_make="Toyota", vehicle_model="Camry",
            vehicle_year=2020, vehicle_color="Blue", license_plate="ABC123"
        )
        return run(api_driver_apply(req, body))

    def test_driver_apply_requires_login(self):
        from api.app import api_driver_apply, _DriverApplyRequest
        req = _make_request({})
        body = _DriverApplyRequest(
            vehicle_make="Toyota", vehicle_model="Camry",
            vehicle_year=2020, vehicle_color="Blue", license_plate="ABC123"
        )
        resp = run(api_driver_apply(req, body))
        assert resp.status_code == 401

    def test_driver_apply_ok(self):
        import json
        resp, uid = _register_user("ApplyDriver")
        user_body = json.loads(resp.body)
        user_id = user_body["user_id"]
        apply_resp = self._apply(user_id)
        assert apply_resp.status_code == 201
        data = json.loads(apply_resp.body)
        assert data.get("ok") is True

    def test_driver_apply_missing_make_returns_400(self):
        from api.app import api_driver_apply, _DriverApplyRequest
        import json
        resp, uid = _register_user("ApplyBadDriver")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        body = _DriverApplyRequest(
            vehicle_make="", vehicle_model="Camry",
            vehicle_year=2020, vehicle_color="Blue", license_plate="ABC123"
        )
        resp2 = run(api_driver_apply(req, body))
        assert resp2.status_code == 400

    def test_driver_application_status(self):
        from api.app import api_driver_application_status
        import json
        resp, uid = _register_user("AppStatus")
        user_id = json.loads(resp.body)["user_id"]
        self._apply(user_id)
        req = _make_request({"app_user_id": user_id})
        status_resp = run(api_driver_application_status(req))
        data = json.loads(status_resp.body)
        assert data["application"] is not None
        assert data["application"]["status"] == "pending"

    def test_admin_approve_driver_application(self):
        from api.app import api_admin_driver_approve, _DriverApproveRequest, _get_app_user
        import json
        resp, uid = _register_user("ToApprove")
        user_id = json.loads(resp.body)["user_id"]
        apply_resp = self._apply(user_id)
        app_id = json.loads(apply_resp.body)["app_id"]

        admin_req = _make_request({"admin_user": "admin"})
        approve_resp = run(api_admin_driver_approve(admin_req, app_id, _DriverApproveRequest(approved=True)))
        data = json.loads(approve_resp.body)
        assert data.get("ok") is True
        assert data.get("status") == "approved"

        # User role should now be 'driver'
        user = _get_app_user(user_id)
        assert user["role"] == "driver"

    def test_admin_reject_driver_application(self):
        from api.app import api_admin_driver_approve, _DriverApproveRequest, _get_app_user
        import json
        resp, uid = _register_user("ToReject")
        user_id = json.loads(resp.body)["user_id"]
        apply_resp = self._apply(user_id)
        app_id = json.loads(apply_resp.body)["app_id"]

        admin_req = _make_request({"admin_user": "admin"})
        reject_resp = run(api_admin_driver_approve(admin_req, app_id, _DriverApproveRequest(approved=False)))
        data = json.loads(reject_resp.body)
        assert data["status"] == "rejected"

        # User role should remain 'passenger'
        user = _get_app_user(user_id)
        assert user["role"] == "passenger"

    def test_driver_apply_with_subscription_type(self):
        """Subscription type (monthly/yearly) is stored on the application."""
        from api.app import api_driver_apply, _DriverApplyRequest, api_driver_application_status
        import json
        resp, _ = _register_user("SubDriver")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        apply_resp = run(api_driver_apply(req, _DriverApplyRequest(
            vehicle_make="Honda", vehicle_model="Civic",
            vehicle_year=2021, vehicle_color="Red", license_plate="XYZ999",
            subscription_type="yearly",
        )))
        assert apply_resp.status_code == 201
        status_resp = run(api_driver_application_status(_make_request({"app_user_id": user_id})))
        data = json.loads(status_resp.body)
        assert data["application"]["subscription_type"] == "yearly"

    def test_driver_apply_invalid_subscription_defaults_to_monthly(self):
        """An invalid subscription_type value should default to 'monthly'."""
        from api.app import api_driver_apply, _DriverApplyRequest, api_driver_application_status
        import json
        resp, _ = _register_user("BadSubDriver")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        apply_resp = run(api_driver_apply(req, _DriverApplyRequest(
            vehicle_make="Ford", vehicle_model="Focus",
            vehicle_year=2019, vehicle_color="Black", license_plate="BAD000",
            subscription_type="weekly",  # invalid value
        )))
        assert apply_resp.status_code == 201
        status_resp = run(api_driver_application_status(_make_request({"app_user_id": user_id})))
        data = json.loads(status_resp.body)
        assert data["application"]["subscription_type"] == "monthly"


# ===========================================================================
# Ride History
# ===========================================================================

class TestRideHistory:
    """Tests for /api/rides/history."""

    def test_ride_history_requires_login(self):
        from api.app import api_ride_history
        req = _make_request({})
        resp = run(api_ride_history(req))
        assert resp.status_code == 401

    def test_ride_history_empty_for_new_user(self):
        from api.app import api_ride_history
        import json
        resp, uid = _register_user("HistEmpty")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        hist_resp = run(api_ride_history(req))
        data = json.loads(hist_resp.body)
        assert data["rides"] == []

    def test_ride_history_includes_user_rides(self):
        from api.app import api_ride_history, api_ride_post, _RidePostRequest
        import json
        resp, uid = _register_driver("HistHasRides")
        user_id = json.loads(resp.body)["user_id"]
        session = {"app_user_id": user_id}

        # Post a ride
        post_req = _make_request(session)
        run(api_ride_post(post_req, _RidePostRequest(
            origin="A", destination="B", departure="2026-01-01T10:00", seats=2
        )))

        # Check history
        hist_req = _make_request(session)
        hist_resp = run(api_ride_history(hist_req))
        data = json.loads(hist_resp.body)
        assert len(data["rides"]) == 1
        assert data["rides"][0]["origin"] == "A"


# ===========================================================================
# Remember Me login
# ===========================================================================

class TestRememberMe:
    """Tests for remember_me flag on /api/auth/login."""

    def test_remember_me_sets_session_flag(self):
        from api.app import api_user_login, _UserLoginRequest
        import json
        _, email = _register_user("RememberMe")
        session = {}
        req = _make_request(session)
        resp = run(api_user_login(req, _UserLoginRequest(
            email=email, password="password123", remember_me=True
        )))
        assert resp.status_code == 200
        assert session.get("remember_me") is True

    def test_no_remember_me_does_not_set_flag(self):
        from api.app import api_user_login, _UserLoginRequest
        import json
        _, email = _register_user("NoRememberMe")
        session = {}
        req = _make_request(session)
        run(api_user_login(req, _UserLoginRequest(
            email=email, password="password123", remember_me=False
        )))
        assert "remember_me" not in session


# ===========================================================================
# User Dashboard
# ===========================================================================

class TestUserDashboard:
    """Tests for GET /api/user/dashboard."""

    def test_dashboard_requires_login(self):
        from api.app import api_user_dashboard
        req = _make_request({})
        resp = run(api_user_dashboard(req))
        assert resp.status_code == 401

    def test_dashboard_returns_user_and_stats(self):
        import json
        from api.app import api_user_dashboard
        resp, _ = _register_user("DashUser")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        dash_resp = run(api_user_dashboard(req))
        assert dash_resp.status_code == 200
        data = json.loads(dash_resp.body)
        assert "user" in data
        assert data["user"]["user_id"] == user_id
        assert "stats" in data
        assert "total_rides" in data["stats"]
        assert "open_rides" in data["stats"]
        assert "recent_rides" in data

    def test_dashboard_stats_reflect_posted_rides(self):
        import json
        from api.app import api_user_dashboard, api_ride_post, _RidePostRequest
        resp, _ = _register_driver("DashRideUser")
        user_id = json.loads(resp.body)["user_id"]
        session = {"app_user_id": user_id}

        # Post two rides
        for i in range(2):
            run(api_ride_post(
                _make_request(session),
                _RidePostRequest(origin=f"A{i}", destination=f"B{i}", departure="2026-06-01T09:00", seats=1),
            ))

        req = _make_request(session)
        data = json.loads(run(api_user_dashboard(req)).body)
        assert data["stats"]["total_rides"] >= 2
        assert len(data["recent_rides"]) >= 1

    def test_dashboard_recent_rides_limit(self):
        """recent_rides should contain at most 5 entries."""
        import json
        from api.app import api_user_dashboard, api_ride_post, _RidePostRequest
        resp, _ = _register_driver("DashLimit")
        user_id = json.loads(resp.body)["user_id"]
        session = {"app_user_id": user_id}

        for i in range(7):
            run(api_ride_post(
                _make_request(session),
                _RidePostRequest(origin=f"X{i}", destination=f"Y{i}", departure="2026-07-01T10:00", seats=1),
            ))

        data = json.loads(run(api_user_dashboard(_make_request(session))).body)
        assert len(data["recent_rides"]) <= 5



# ---------------------------------------------------------------------------
# Profile details update & avatar upload
# ---------------------------------------------------------------------------

class TestProfileDetailsUpdate:
    """Tests for PUT /api/auth/profile/details."""

    def test_update_requires_login(self):
        from api.app import api_user_update_profile_details, _UserProfileDetailsUpdate
        req = _make_request({})
        resp = run(api_user_update_profile_details(req, _UserProfileDetailsUpdate(name="X", bio="y")))
        assert resp.status_code == 401

    def test_update_bio(self):
        import json
        from api.app import api_user_update_profile_details, _UserProfileDetailsUpdate, _get_app_user
        resp, _ = _register_user("BioPerson")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        r = run(api_user_update_profile_details(req, _UserProfileDetailsUpdate(name="BioPerson", bio="Hello world")))
        assert r.status_code == 200
        data = json.loads(r.body)
        assert data["ok"] is True
        u = _get_app_user(user_id)
        assert u["bio"] == "Hello world"

    def test_update_name(self):
        import json
        from api.app import api_user_update_profile_details, _UserProfileDetailsUpdate, _get_app_user
        resp, _ = _register_user("OldName")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        run(api_user_update_profile_details(req, _UserProfileDetailsUpdate(name="NewName", bio="")))
        u = _get_app_user(user_id)
        assert u["name"] == "NewName"

    def test_bio_truncated_to_500(self):
        import json
        from api.app import api_user_update_profile_details, _UserProfileDetailsUpdate, _get_app_user
        resp, _ = _register_user("LongBio")
        user_id = json.loads(resp.body)["user_id"]
        long_bio = "x" * 1000
        req = _make_request({"app_user_id": user_id})
        run(api_user_update_profile_details(req, _UserProfileDetailsUpdate(name="LongBio", bio=long_bio)))
        u = _get_app_user(user_id)
        assert len(u["bio"]) <= 500


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

class TestNotifications:
    """Tests for GET /api/notifications and POST /api/notifications/{id}/read."""

    def test_get_notifications_requires_login(self):
        from api.app import api_get_notifications
        req = _make_request({})
        resp = run(api_get_notifications(req))
        assert resp.status_code == 401

    def test_get_notifications_empty_for_new_user(self):
        import json
        from api.app import api_get_notifications
        resp, _ = _register_user("NotifEmpty")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        r = run(api_get_notifications(req))
        assert r.status_code == 200
        data = json.loads(r.body)
        assert "notifications" in data
        assert data["unread"] == 0

    def test_create_and_retrieve_notification(self):
        import json
        from api.app import api_get_notifications, _create_notification
        resp, _ = _register_user("NotifUser")
        user_id = json.loads(resp.body)["user_id"]
        _create_notification(user_id, "system", "Test Title", "Test body")
        req = _make_request({"app_user_id": user_id})
        data = json.loads(run(api_get_notifications(req)).body)
        assert len(data["notifications"]) >= 1
        n = data["notifications"][0]
        assert n["title"] == "Test Title"
        assert n["body"] == "Test body"
        assert n["read"] == 0
        assert data["unread"] >= 1

    def test_mark_notification_read(self):
        import json
        from api.app import api_get_notifications, api_mark_notification_read, _create_notification
        resp, _ = _register_user("NotifRead")
        user_id = json.loads(resp.body)["user_id"]
        notif_id = _create_notification(user_id, "system", "Hello", "Body")
        req = _make_request({"app_user_id": user_id})
        run(api_mark_notification_read(req, notif_id))
        data = json.loads(run(api_get_notifications(req)).body)
        n = next((x for x in data["notifications"] if x["notif_id"] == notif_id), None)
        assert n is not None
        assert n["read"] == 1

    def test_mark_all_notifications_read(self):
        import json
        from api.app import api_get_notifications, api_mark_all_notifications_read, _create_notification
        resp, _ = _register_user("NotifAllRead")
        user_id = json.loads(resp.body)["user_id"]
        for i in range(3):
            _create_notification(user_id, "system", f"Title {i}", f"Body {i}")
        req = _make_request({"app_user_id": user_id})
        run(api_mark_all_notifications_read(req))
        data = json.loads(run(api_get_notifications(req)).body)
        assert data["unread"] == 0
        assert all(n["read"] == 1 for n in data["notifications"])

    def test_mark_read_requires_login(self):
        from api.app import api_mark_notification_read
        req = _make_request({})
        resp = run(api_mark_notification_read(req, "fake-id"))
        assert resp.status_code == 401

    def test_driver_approval_creates_notification(self):
        """Approving a driver application should create an in-app notification."""
        import json
        from api.app import (
            api_admin_driver_approve, api_get_notifications,
            _DriverApproveRequest, _create_notification
        )
        resp, _ = _register_user("NotifDriver")
        user_id = json.loads(resp.body)["user_id"]
        # Manually insert a driver application
        from api.app import _get_db, _db_lock, USE_POSTGRES
        import uuid, datetime
        app_id = str(uuid.uuid4())
        created = datetime.datetime.utcnow().isoformat()
        with _db_lock:
            conn = _get_db()
            try:
                if USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (app_id, user_id, "Toyota", "Camry", 2020, "Blue", "ABC123", created)
                    )
                else:
                    conn.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (app_id, user_id, "Toyota", "Camry", 2020, "Blue", "ABC123", created)
                    )
                conn.commit()
            finally:
                conn.close()
        # Approve
        admin_req = _make_request({"admin_user": "admin"})
        run(api_admin_driver_approve(admin_req, app_id, _DriverApproveRequest(approved=True)))
        # Check notification was created
        user_req = _make_request({"app_user_id": user_id})
        data = json.loads(run(api_get_notifications(user_req)).body)
        types = [n["type"] for n in data["notifications"]]
        assert "driver_approved" in types

    def test_clear_all_notifications_requires_login(self):
        from api.app import api_clear_all_notifications
        req = _make_request({})
        resp = run(api_clear_all_notifications(req))
        assert resp.status_code == 401

    def test_clear_all_notifications_removes_all(self):
        import json
        from api.app import api_get_notifications, api_clear_all_notifications, _create_notification
        resp, _ = _register_user("NotifClearAll")
        user_id = json.loads(resp.body)["user_id"]
        for i in range(3):
            _create_notification(user_id, "system", f"Title {i}", f"Body {i}")
        req = _make_request({"app_user_id": user_id})
        # Verify notifications exist
        data = json.loads(run(api_get_notifications(req)).body)
        assert len(data["notifications"]) >= 3
        # Clear all
        clear_resp = run(api_clear_all_notifications(req))
        assert clear_resp.status_code == 200
        assert json.loads(clear_resp.body)["ok"] is True
        # Verify empty
        data2 = json.loads(run(api_get_notifications(req)).body)
        assert len(data2["notifications"]) == 0
        assert data2["unread"] == 0


# ── Admin Reviews ──────────────────────────────────────────────────────────────

class TestAdminReviews:
    """Tests for GET /api/admin/reviews and DELETE /api/admin/reviews/{review_id}."""

    def test_get_admin_reviews_requires_admin(self):
        """Non-admin request should be rejected with 401."""
        import json
        from api.app import api_admin_reviews
        req = _make_request({})
        resp = run(api_admin_reviews(req))
        assert resp.status_code == 401

    def test_get_admin_reviews_returns_list(self):
        """Admin can list reviews; returns list including IP info."""
        import json
        from api.app import api_admin_reviews, submit_review, reviews
        # Add a review directly to memory
        from api.app import reviews_lock, _save_review_to_db
        import uuid, time
        review = {
            "id": str(uuid.uuid4()),
            "name": "AdminTestUser",
            "comment": "Great service!",
            "rating": 5,
            "timestamp": time.time(),
            "ip": "1.2.3.4",
        }
        with reviews_lock:
            reviews.insert(0, review)
        _save_review_to_db(review)

        admin_req = _make_request({"admin_user": "admin"})
        resp = run(api_admin_reviews(admin_req))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert "reviews" in data
        # Reviews should include IP info
        ids = [r["id"] for r in data["reviews"]]
        assert review["id"] in ids
        found = next(r for r in data["reviews"] if r["id"] == review["id"])
        assert found["ip"] == "1.2.3.4"

        # Cleanup
        with reviews_lock:
            reviews[:] = [r for r in reviews if r["id"] != review["id"]]

    def test_get_admin_reviews_admin_logged_in_session(self):
        """Admin with admin_logged_in session key should also be allowed."""
        import json
        from api.app import api_admin_reviews
        req = _make_request({"admin_logged_in": True})
        resp = run(api_admin_reviews(req))
        assert resp.status_code == 200

    def test_delete_admin_review_requires_admin(self):
        """Non-admin DELETE should be rejected with 401."""
        from api.app import api_admin_delete_review
        req = _make_request({})
        resp = run(api_admin_delete_review(req, "some-id"))
        assert resp.status_code == 401

    def test_delete_admin_review_not_found(self):
        """Deleting a non-existent review should return 404."""
        import json
        from api.app import api_admin_delete_review
        req = _make_request({"admin_user": "admin"})
        resp = run(api_admin_delete_review(req, "non-existent-id-xyz"))
        assert resp.status_code == 404

    def test_delete_admin_review_removes_review(self):
        """Deleting a review should remove it from the in-memory list."""
        import json
        from api.app import api_admin_delete_review, api_admin_reviews, reviews, reviews_lock, _save_review_to_db
        import uuid, time
        review_id = str(uuid.uuid4())
        review = {
            "id": review_id,
            "name": "ToDelete",
            "comment": "Delete me",
            "rating": 3,
            "timestamp": time.time(),
            "ip": "5.6.7.8",
        }
        with reviews_lock:
            reviews.insert(0, review)
        _save_review_to_db(review)

        admin_req = _make_request({"admin_user": "admin"})
        # Delete it
        resp = run(api_admin_delete_review(admin_req, review_id))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert data.get("ok") is True

        # Verify it's gone from in-memory list
        with reviews_lock:
            ids = [r["id"] for r in reviews]
        assert review_id not in ids

    def test_delete_admin_review_idempotent(self):
        """Deleting the same review twice should return 404 the second time."""
        import json
        from api.app import api_admin_delete_review, reviews, reviews_lock, _save_review_to_db
        import uuid, time
        review_id = str(uuid.uuid4())
        review = {
            "id": review_id,
            "name": "ToDeleteTwice",
            "comment": "Delete twice",
            "rating": 2,
            "timestamp": time.time(),
            "ip": "9.8.7.6",
        }
        with reviews_lock:
            reviews.insert(0, review)
        _save_review_to_db(review)

        admin_req = _make_request({"admin_user": "admin"})
        run(api_admin_delete_review(admin_req, review_id))
        # Second delete
        resp2 = run(api_admin_delete_review(admin_req, review_id))
        assert resp2.status_code == 404


# ===========================================================================
# Real estate agent tests
# ===========================================================================

class TestRealEstateAgents:
    """Tests for /api/agents endpoints and agent chat socket events."""

    def test_list_agents_returns_agents(self):
        """GET /api/agents should return at least the seeded demo agents."""
        import json
        from api.app import api_list_agents
        resp = run(api_list_agents())
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert "agents" in data
        assert isinstance(data["agents"], list)
        assert len(data["agents"]) > 0

    def test_list_agents_available_first(self):
        """Agents without a status filter should return available agents first."""
        import json
        from api.app import api_list_agents
        resp = run(api_list_agents())
        data = json.loads(resp.body)
        agents = data["agents"]
        statuses = [a["availability_status"] for a in agents]
        # All 'available' entries should appear before any 'busy' or 'offline'
        seen_non_available = False
        for s in statuses:
            if s != "available":
                seen_non_available = True
            if seen_non_available and s == "available":
                assert False, "available agent appeared after non-available agent"

    def test_list_agents_filter_by_status(self):
        """GET /api/agents?status=available should only return available agents."""
        import json
        from api.app import api_list_agents
        resp = run(api_list_agents(status="available"))
        data = json.loads(resp.body)
        for a in data["agents"]:
            assert a["availability_status"] == "available"

    def test_get_agent_returns_detail(self):
        """GET /api/agents/{agent_id} should return full agent profile."""
        import json
        from api.app import api_list_agents, api_get_agent
        # Get the first agent
        agents_resp = run(api_list_agents())
        agents = json.loads(agents_resp.body)["agents"]
        agent_id = agents[0]["agent_id"]

        resp = run(api_get_agent(agent_id))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert "agent" in data
        assert data["agent"]["agent_id"] == agent_id
        assert "reviews" in data["agent"]
        assert "review_count" in data["agent"]
        assert "avg_rating" in data["agent"]

    def test_get_agent_not_found(self):
        """GET /api/agents/nonexistent should return 404."""
        from api.app import api_get_agent
        resp = run(api_get_agent("nonexistent-agent-xyz"))
        assert resp.status_code == 404

    def test_update_agent_status_requires_login(self):
        """PUT /api/agents/{id}/status without login should return 401."""
        from api.app import api_update_agent_status, _AgentStatusUpdate, api_list_agents
        import json
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        req = _make_request({})
        resp = run(api_update_agent_status(req, agent_id, _AgentStatusUpdate(status="busy")))
        assert resp.status_code == 401

    def test_update_agent_status_invalid_status(self):
        """PUT with invalid status should return 400."""
        from api.app import api_update_agent_status, _AgentStatusUpdate, api_list_agents
        import json
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        req = _make_request({"admin_logged_in": True})
        resp = run(api_update_agent_status(req, agent_id, _AgentStatusUpdate(status="invisible")))
        assert resp.status_code == 400

    def test_update_agent_status_admin_ok(self):
        """Admin should be able to update any agent's status."""
        import json
        from api.app import api_update_agent_status, _AgentStatusUpdate, api_list_agents, api_get_agent
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        req = _make_request({"admin_logged_in": True})
        resp = run(api_update_agent_status(req, agent_id, _AgentStatusUpdate(status="busy")))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert data["ok"] is True
        assert data["status"] == "busy"
        # Verify persisted
        detail = json.loads(run(api_get_agent(agent_id)).body)
        assert detail["agent"]["availability_status"] == "busy"

    def test_submit_agent_review_requires_login(self):
        """POST /api/agents/{id}/review without login should return 401."""
        import json
        from api.app import api_submit_agent_review, _AgentReviewRequest, api_list_agents
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        req = _make_request({})
        resp = run(api_submit_agent_review(req, agent_id, _AgentReviewRequest(rating=5, text="Great!")))
        assert resp.status_code == 401

    def test_submit_agent_review_invalid_rating(self):
        """Rating outside 1-5 should return 400."""
        import json
        from api.app import api_submit_agent_review, _AgentReviewRequest, api_list_agents
        from api.app import api_user_register, _UserRegisterRequest
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        # Register a user
        email = f"reviewer_{uuid.uuid4().hex[:8]}@test.com"
        user_id = str(uuid.uuid4())
        run(api_user_register(_UserRegisterRequest(name="Reviewer", email=email, password="pass1234")))
        # Find user_id by email
        from api.app import _get_db, _db_lock, USE_POSTGRES
        with _db_lock:
            conn = _get_db()
            try:
                from api.app import _execute
                cur = _execute(conn, "SELECT user_id FROM app_users WHERE email=?" if not USE_POSTGRES else "SELECT user_id FROM app_users WHERE email=%s", (email,))
                row = cur.fetchone()
                user_id = row[0] if row else None
            finally:
                conn.close()
        req = _make_request({"app_user_id": user_id})
        resp = run(api_submit_agent_review(req, agent_id, _AgentReviewRequest(rating=6, text="Too high")))
        assert resp.status_code == 400

    def test_submit_agent_review_ok(self):
        """Logged-in user should be able to submit a review."""
        import json
        from api.app import api_submit_agent_review, _AgentReviewRequest, api_list_agents
        from api.app import api_user_register, _UserRegisterRequest, api_get_agent
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        email = f"reviewer_{uuid.uuid4().hex[:8]}@test.com"
        run(api_user_register(_UserRegisterRequest(name="Good Reviewer", email=email, password="pass1234")))
        from api.app import _get_db, _db_lock, USE_POSTGRES, _execute
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(conn, "SELECT user_id FROM app_users WHERE email=?" if not USE_POSTGRES else "SELECT user_id FROM app_users WHERE email=%s", (email,))
                row = cur.fetchone()
                user_id = row[0] if row else None
            finally:
                conn.close()
        req = _make_request({"app_user_id": user_id})
        resp = run(api_submit_agent_review(req, agent_id, _AgentReviewRequest(rating=4, text="Very helpful!")))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert data["ok"] is True
        assert "review_id" in data
        # Verify review appears in agent detail
        detail = json.loads(run(api_get_agent(agent_id)).body)
        review_ids = [r["review_id"] for r in detail["agent"]["reviews"]]
        assert data["review_id"] in review_ids

    def test_like_agent_requires_login(self):
        """POST /api/agents/{id}/like without login should return 401."""
        import json
        from api.app import api_like_agent, api_list_agents
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        req = _make_request({})
        resp = run(api_like_agent(req, agent_id))
        assert resp.status_code == 401

    def test_like_agent_toggle(self):
        """Liking should toggle: first like increments count, second like decrements."""
        import json
        from api.app import api_like_agent, api_list_agents
        from api.app import api_user_register, _UserRegisterRequest, _get_db, _db_lock, USE_POSTGRES, _execute
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[1]["agent_id"]
        email = f"liker_{uuid.uuid4().hex[:8]}@test.com"
        run(api_user_register(_UserRegisterRequest(name="Liker", email=email, password="pass1234")))
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(conn, "SELECT user_id FROM app_users WHERE email=?" if not USE_POSTGRES else "SELECT user_id FROM app_users WHERE email=%s", (email,))
                row = cur.fetchone()
                user_id = row[0] if row else None
            finally:
                conn.close()
        req = _make_request({"app_user_id": user_id})
        resp1 = run(api_like_agent(req, agent_id))
        data1 = json.loads(resp1.body)
        assert resp1.status_code == 200
        assert data1["liked"] is True
        count_after_like = data1["like_count"]
        # Like again → unlike
        resp2 = run(api_like_agent(req, agent_id))
        data2 = json.loads(resp2.body)
        assert data2["liked"] is False
        assert data2["like_count"] == count_after_like - 1

    def test_get_agent_chat_requires_login(self):
        """GET /api/agents/{id}/chat without login should return 401."""
        import json
        from api.app import api_get_agent_chat, api_list_agents
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        req = _make_request({})
        resp = run(api_get_agent_chat(req, agent_id))
        assert resp.status_code == 401

    def test_get_agent_chat_empty_for_new_user(self):
        """New user should see an empty chat history."""
        import json
        from api.app import api_get_agent_chat, api_list_agents
        from api.app import api_user_register, _UserRegisterRequest, _get_db, _db_lock, USE_POSTGRES, _execute
        agents = json.loads(run(api_list_agents()).body)["agents"]
        agent_id = agents[0]["agent_id"]
        email = f"chatter_{uuid.uuid4().hex[:8]}@test.com"
        run(api_user_register(_UserRegisterRequest(name="Chatter", email=email, password="pass1234")))
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(conn, "SELECT user_id FROM app_users WHERE email=?" if not USE_POSTGRES else "SELECT user_id FROM app_users WHERE email=%s", (email,))
                row = cur.fetchone()
                user_id = row[0] if row else None
            finally:
                conn.close()
        req = _make_request({"app_user_id": user_id})
        resp = run(api_get_agent_chat(req, agent_id))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert "messages" in data
        assert data["messages"] == []

    def test_agents_have_review_and_like_counts(self):
        """Agent list entries should include review_count, avg_rating, like_count fields."""
        import json
        from api.app import api_list_agents
        agents = json.loads(run(api_list_agents()).body)["agents"]
        for a in agents:
            assert "review_count" in a
            assert "avg_rating" in a
            assert "like_count" in a


class TestAgentProfileVisit:
    """Tests for the agent_profile_visit socket event."""

    def test_profile_visit_ignores_missing_agent_id(self):
        """on_agent_profile_visit with no agent_id should do nothing."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append(evt))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_agent_profile_visit("sid-x", {})

        _asyncio.run(_run())
        assert emitted == []

    def test_profile_visit_ignores_non_dict(self):
        """on_agent_profile_visit with a non-dict payload should do nothing."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        emitted = []

        async def _run():
            mock_emit = AsyncMock(side_effect=lambda evt, data=None, room=None: emitted.append(evt))
            with patch.object(app_module.sio, "emit", mock_emit):
                await app_module.on_agent_profile_visit("sid-y", "bad_payload")

        _asyncio.run(_run())
        assert emitted == []

    def test_profile_visit_notifies_linked_agent(self):
        """on_agent_profile_visit should emit agent_profile_visit_notify to the linked agent's socket."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        emitted = []

        async def _run():
            # Fake a known agent_id → user_id → sid mapping
            fake_agent_id = "test-agent-999"
            fake_user_id  = "linked-user-999"
            fake_agent_sid = "agent-socket-sid-999"

            fake_agent = {"agent_id": fake_agent_id, "user_id": fake_user_id, "name": "Test Agent"}

            async def mock_emit(evt, data=None, room=None, skip_sid=None):
                emitted.append((evt, data, room))

            with patch.object(app_module.sio, "emit", mock_emit), \
                 patch("api.app._get_agent_row", return_value=fake_agent), \
                 patch.dict(app_module._user_to_sid, {fake_user_id: fake_agent_sid}):
                await app_module.on_agent_profile_visit("visitor-sid", {
                    "agent_id": fake_agent_id,
                    "user_id":  "visitor-user-001",
                })

        _asyncio.run(_run())
        notifs = [e for e in emitted if e[0] == "agent_profile_visit_notify"]
        assert len(notifs) == 1
        payload = notifs[0][1]
        assert payload["agent_id"] == "test-agent-999"
        assert payload["visitor_id"] == "visitor-user-001"
        assert "ts" in payload

    def test_profile_visit_no_notify_when_agent_offline(self):
        """on_agent_profile_visit should not emit if the agent has no connected socket."""
        import asyncio as _asyncio
        from unittest.mock import AsyncMock, patch
        import api.app as app_module

        emitted = []

        async def _run():
            fake_agent = {"agent_id": "offline-agent", "user_id": "offline-user", "name": "Offline"}

            async def mock_emit(evt, data=None, room=None, skip_sid=None):
                emitted.append(evt)

            with patch.object(app_module.sio, "emit", mock_emit), \
                 patch("api.app._get_agent_row", return_value=fake_agent), \
                 patch.dict(app_module._user_to_sid, {}, clear=True):
                await app_module.on_agent_profile_visit("visitor-sid2", {
                    "agent_id": "offline-agent",
                    "user_id":  "visitor-002",
                })

        _asyncio.run(_run())
        assert "agent_profile_visit_notify" not in emitted


# ---------------------------------------------------------------------------
# Direct Messaging (DM)
# ---------------------------------------------------------------------------

class TestDirectMessaging:
    """Tests for the user-to-user DM endpoints and helpers."""

    def _register_and_get_id(self, name="DMUser", role="passenger"):
        resp, email = _register_user(name=name, role=role)
        import json
        from api.app import _get_db, _db_lock, USE_POSTGRES, _execute
        with _db_lock:
            conn = _get_db()
            try:
                cur = _execute(
                    conn,
                    "SELECT user_id FROM app_users WHERE email=?" if not USE_POSTGRES else "SELECT user_id FROM app_users WHERE email=%s",
                    (email,),
                )
                row = cur.fetchone()
                return row[0] if row else None
            finally:
                conn.close()

    def test_list_conversations_requires_login(self):
        """GET /api/dm/conversations without login → 401."""
        import json
        from api.app import api_dm_list_conversations
        req = _make_request({})
        resp = run(api_dm_list_conversations(req))
        assert resp.status_code == 401

    def test_list_conversations_empty_for_new_user(self):
        """New user has no DM conversations."""
        import json
        from api.app import api_dm_list_conversations
        uid = self._register_and_get_id("DMNewUser")
        req = _make_request({"app_user_id": uid})
        resp = run(api_dm_list_conversations(req))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert data["conversations"] == []

    def test_start_conversation_requires_login(self):
        """POST /api/dm/conversations without login → 401."""
        import json
        from api.app import api_dm_start_conversation, _DMStartRequest
        req = _make_request({})
        resp = run(api_dm_start_conversation(req, _DMStartRequest(other_user_id="someone")))
        assert resp.status_code == 401

    def test_start_conversation_with_nonexistent_user(self):
        """POST /api/dm/conversations with unknown user → 404."""
        import json
        from api.app import api_dm_start_conversation, _DMStartRequest
        uid = self._register_and_get_id("DMStarter")
        req = _make_request({"app_user_id": uid})
        resp = run(api_dm_start_conversation(req, _DMStartRequest(other_user_id="does-not-exist")))
        assert resp.status_code == 404

    def test_start_conversation_creates_and_returns_conv(self):
        """Two users can start a conversation; repeated calls return same conv_id."""
        import json
        from api.app import api_dm_start_conversation, _DMStartRequest
        uid_a = self._register_and_get_id("DM_Alice")
        uid_b = self._register_and_get_id("DM_Bob")
        req = _make_request({"app_user_id": uid_a})
        # First call creates conversation
        resp1 = run(api_dm_start_conversation(req, _DMStartRequest(other_user_id=uid_b)))
        assert resp1.status_code == 200
        data1 = json.loads(resp1.body)
        assert "conv" in data1
        conv_id = data1["conv"]["conv_id"]
        assert conv_id
        # Second call returns the same conversation
        resp2 = run(api_dm_start_conversation(req, _DMStartRequest(other_user_id=uid_b)))
        data2 = json.loads(resp2.body)
        assert data2["conv"]["conv_id"] == conv_id

    def test_get_messages_requires_login(self):
        """GET /api/dm/conversations/{conv_id}/messages without login → 401."""
        import json
        from api.app import api_dm_get_messages
        req = _make_request({})
        resp = run(api_dm_get_messages(req, "fake-conv-id"))
        assert resp.status_code == 401

    def test_get_messages_forbidden_for_non_participant(self):
        """Non-participant cannot read messages in a DM conversation."""
        import json
        from api.app import api_dm_start_conversation, api_dm_get_messages, _DMStartRequest
        uid_a = self._register_and_get_id("DM_C")
        uid_b = self._register_and_get_id("DM_D")
        uid_c = self._register_and_get_id("DM_E")
        req_a = _make_request({"app_user_id": uid_a})
        conv_resp = run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b)))
        conv_id = json.loads(conv_resp.body)["conv"]["conv_id"]
        # User C tries to read
        req_c = _make_request({"app_user_id": uid_c})
        resp = run(api_dm_get_messages(req_c, conv_id))
        assert resp.status_code == 403

    def test_send_and_receive_message(self):
        """Sending a DM persists it and is returned when fetching messages."""
        import json
        from api.app import (
            api_dm_start_conversation, api_dm_send, api_dm_get_messages,
            _DMStartRequest, _DMSendRequest,
        )
        uid_a = self._register_and_get_id("DM_Sender")
        uid_b = self._register_and_get_id("DM_Receiver")
        req_a = _make_request({"app_user_id": uid_a})
        # Start conversation
        conv_id = json.loads(run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b))).body)["conv"]["conv_id"]
        # Send message
        send_resp = run(api_dm_send(req_a, _DMSendRequest(conv_id=conv_id, content="Hello DM world!")))
        assert send_resp.status_code == 200
        send_data = json.loads(send_resp.body)
        assert send_data["ok"] is True
        assert send_data["message"]["content"] == "Hello DM world!"
        # Fetch messages
        msg_resp = run(api_dm_get_messages(req_a, conv_id))
        assert msg_resp.status_code == 200
        msgs = json.loads(msg_resp.body)["messages"]
        assert any(m["content"] == "Hello DM world!" for m in msgs)

    def test_send_empty_message_rejected(self):
        """Empty content is rejected with 400."""
        import json
        from api.app import (
            api_dm_start_conversation, api_dm_send,
            _DMStartRequest, _DMSendRequest,
        )
        uid_a = self._register_and_get_id("DM_EmptySender")
        uid_b = self._register_and_get_id("DM_EmptyReceiver")
        req_a = _make_request({"app_user_id": uid_a})
        conv_id = json.loads(run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b))).body)["conv"]["conv_id"]
        resp = run(api_dm_send(req_a, _DMSendRequest(conv_id=conv_id, content="   ")))
        assert resp.status_code == 400

    def test_mark_read_clears_unread_count(self):
        """After marking read, unread_count for the reader drops to 0."""
        import json
        from api.app import (
            api_dm_start_conversation, api_dm_send, api_dm_mark_read,
            api_dm_list_conversations,
            _DMStartRequest, _DMSendRequest,
        )
        uid_a = self._register_and_get_id("DM_ReadA")
        uid_b = self._register_and_get_id("DM_ReadB")
        req_a = _make_request({"app_user_id": uid_a})
        req_b = _make_request({"app_user_id": uid_b})
        conv_id = json.loads(run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b))).body)["conv"]["conv_id"]
        # A sends a message → B has unread=1
        run(api_dm_send(req_a, _DMSendRequest(conv_id=conv_id, content="Hey!")))
        convs_b = json.loads(run(api_dm_list_conversations(req_b)).body)["conversations"]
        unread_before = next(c["unread_count"] for c in convs_b if c["conv_id"] == conv_id)
        assert unread_before == 1
        # B marks read
        read_resp = run(api_dm_mark_read(req_b, conv_id))
        assert read_resp.status_code == 200
        convs_b2 = json.loads(run(api_dm_list_conversations(req_b)).body)["conversations"]
        unread_after = next(c["unread_count"] for c in convs_b2 if c["conv_id"] == conv_id)
        assert unread_after == 0

    def test_reply_to_message(self):
        """reply_to_id is persisted and returned with the message."""
        import json
        from api.app import (
            api_dm_start_conversation, api_dm_send, api_dm_get_messages,
            _DMStartRequest, _DMSendRequest,
        )
        uid_a = self._register_and_get_id("DM_ReplyA")
        uid_b = self._register_and_get_id("DM_ReplyB")
        req_a = _make_request({"app_user_id": uid_a})
        conv_id = json.loads(run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b))).body)["conv"]["conv_id"]
        # First message
        first = json.loads(run(api_dm_send(req_a, _DMSendRequest(conv_id=conv_id, content="First message"))).body)["message"]
        first_id = first["msg_id"]
        # Reply
        run(api_dm_send(req_a, _DMSendRequest(conv_id=conv_id, content="Reply!", reply_to_id=first_id)))
        msgs = json.loads(run(api_dm_get_messages(req_a, conv_id)).body)["messages"]
        reply = next((m for m in msgs if m.get("reply_to_id") == first_id), None)
        assert reply is not None
        assert reply["content"] == "Reply!"

    def test_list_users_requires_login(self):
        """GET /api/users/list without login → 401."""
        from api.app import api_list_users
        req = _make_request({})
        resp = run(api_list_users(req))
        assert resp.status_code == 401

    def test_list_users_excludes_self(self):
        """GET /api/users/list should not include the requesting user."""
        import json
        from api.app import api_list_users
        uid = self._register_and_get_id("DM_SelfExclude")
        req = _make_request({"app_user_id": uid})
        resp = run(api_list_users(req))
        assert resp.status_code == 200
        users = json.loads(resp.body)["users"]
        assert all(u["user_id"] != uid for u in users)

    def test_delete_conversation_requires_login(self):
        """DELETE /api/dm/conversations/{conv_id} without login → 401."""
        from api.app import api_dm_delete_conversation
        req = _make_request({})
        resp = run(api_dm_delete_conversation(req, "fake-conv"))
        assert resp.status_code == 401

    def test_delete_conversation_not_found(self):
        """DELETE /api/dm/conversations/{conv_id} with unknown conv → 404."""
        import json
        from api.app import api_dm_delete_conversation
        uid = self._register_and_get_id("DM_DeleteNotFound")
        req = _make_request({"app_user_id": uid})
        resp = run(api_dm_delete_conversation(req, "nonexistent-conv-id"))
        assert resp.status_code == 404

    def test_delete_conversation_removes_messages(self):
        """DELETE /api/dm/conversations/{conv_id} removes the conversation and its messages."""
        import json
        from api.app import (
            api_dm_start_conversation, api_dm_send, api_dm_list_conversations,
            api_dm_delete_conversation, _DMStartRequest, _DMSendRequest,
        )
        uid_a = self._register_and_get_id("DM_DelA")
        uid_b = self._register_and_get_id("DM_DelB")
        req_a = _make_request({"app_user_id": uid_a})
        conv_id = json.loads(run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b))).body)["conv"]["conv_id"]
        # Send a message
        run(api_dm_send(req_a, _DMSendRequest(conv_id=conv_id, content="Delete me")))
        # Delete conversation
        del_resp = run(api_dm_delete_conversation(req_a, conv_id))
        assert del_resp.status_code == 200
        assert json.loads(del_resp.body)["ok"] is True
        # Conversation no longer listed
        convs = json.loads(run(api_dm_list_conversations(req_a)).body)["conversations"]
        assert not any(c["conv_id"] == conv_id for c in convs)

    def test_delete_conversation_access_denied_for_non_participant(self):
        """DELETE /api/dm/conversations/{conv_id} by a non-participant → 403."""
        import json
        from api.app import (
            api_dm_start_conversation, api_dm_delete_conversation, _DMStartRequest,
        )
        uid_a = self._register_and_get_id("DM_DelDeny_A")
        uid_b = self._register_and_get_id("DM_DelDeny_B")
        uid_c = self._register_and_get_id("DM_DelDeny_C")
        req_a = _make_request({"app_user_id": uid_a})
        conv_id = json.loads(run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b))).body)["conv"]["conv_id"]
        req_c = _make_request({"app_user_id": uid_c})
        resp = run(api_dm_delete_conversation(req_c, conv_id))
        assert resp.status_code == 403


# ===========================================================================
# Property Discovery & Inbox
# ===========================================================================

class TestProperties:
    """Tests for /api/properties endpoints."""

    def test_list_properties_returns_properties(self):
        """GET /api/properties should return seeded demo properties."""
        import json
        from api.app import api_list_properties
        resp = run(api_list_properties())
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert "properties" in data
        assert isinstance(data["properties"], list)
        assert len(data["properties"]) > 0

    def test_list_properties_filter_by_status(self):
        """GET /api/properties?status=active should only return active properties."""
        import json
        from api.app import api_list_properties
        resp = run(api_list_properties(status="active"))
        data = json.loads(resp.body)
        for p in data["properties"]:
            assert p["status"] == "active"

    def test_list_properties_has_cover_image(self):
        """Properties in list should have cover_image field."""
        import json
        from api.app import api_list_properties
        resp = run(api_list_properties())
        data = json.loads(resp.body)
        # At least one seeded property should have a cover image
        with_image = [p for p in data["properties"] if p.get("cover_image")]
        assert len(with_image) > 0

    def test_get_property_returns_detail(self):
        """GET /api/properties/:id returns full detail with agents."""
        import json
        from api.app import api_list_properties, api_get_property
        props = json.loads(run(api_list_properties()).body)["properties"]
        pid = props[0]["property_id"]
        resp = run(api_get_property(pid))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert "property" in data
        assert data["property"]["property_id"] == pid
        assert "agents" in data["property"]
        assert isinstance(data["property"]["agents"], list)

    def test_get_property_not_found(self):
        """GET /api/properties/nonexistent → 404."""
        from api.app import api_get_property
        resp = run(api_get_property("nonexistent-property-xyz"))
        assert resp.status_code == 404

    def test_create_property_requires_login(self):
        """POST /api/properties without login → 401."""
        from api.app import api_create_property, _PropertyCreateRequest
        req = _make_request({})
        resp = run(api_create_property(req, _PropertyCreateRequest(title="Test Property")))
        assert resp.status_code == 401

    def test_create_property_ok(self):
        """POST /api/properties with valid data should create a property."""
        import json
        from api.app import api_create_property, _PropertyCreateRequest
        resp_data, email = _register_user(name="PropOwner", role="passenger")
        user_id = json.loads(resp_data.body)["user_id"]
        _grant_posting_permission(user_id)
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_create_property(req, _PropertyCreateRequest(
            title="My Test Property",
            description="A lovely place",
            price=1500.0,
            address="99 Test St, London",
            lat=51.5, lng=-0.1,
            status="active",
        )))
        assert resp.status_code == 201
        data = json.loads(resp.body)
        assert data["ok"] is True
        assert data["property"]["title"] == "My Test Property"
        assert data["property"]["price"] == 1500.0

    def test_create_property_requires_posting_permission(self):
        """POST /api/properties without can_post_properties → 403."""
        from api.app import api_create_property, _PropertyCreateRequest
        _, email = _register_user(name="NoPerm", role="passenger")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_create_property(req, _PropertyCreateRequest(
            title="No Permission",
            lat=51.5, lng=-0.1,
        )))
        assert resp.status_code == 403

    def test_create_property_invalid_status(self):
        """POST /api/properties with invalid status → 400."""
        import json
        from api.app import api_create_property, _PropertyCreateRequest
        resp_data, email = _register_user(name="PropOwner2", role="passenger")
        user_id = json.loads(resp_data.body)["user_id"]
        _grant_posting_permission(user_id)
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_create_property(req, _PropertyCreateRequest(
            title="Bad Status Property",
            lat=51.5, lng=-0.1,
            status="invalid_status",
        )))
        assert resp.status_code == 400

    def test_create_property_max_4_agents(self):
        """POST /api/properties should silently cap agent_ids at 4."""
        import json
        from api.app import api_create_property, api_get_property, _PropertyCreateRequest
        resp_data, email = _register_user(name="PropOwner3", role="passenger")
        user_id = json.loads(resp_data.body)["user_id"]
        _grant_posting_permission(user_id)
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_create_property(req, _PropertyCreateRequest(
            title="Many Agents Property",
            lat=51.5, lng=-0.1,
            agent_ids=["agent-1", "agent-2", "agent-3", "agent-4", "agent-5", "agent-6"],
        )))
        assert resp.status_code == 201
        pid = json.loads(resp.body)["property"]["property_id"]
        detail = json.loads(run(api_get_property(pid)).body)["property"]
        assert len(detail["agents"]) <= 4

    def test_update_property_requires_login(self):
        """PUT /api/properties/:id without login → 401."""
        import json
        from api.app import api_update_property, _PropertyUpdateRequest
        # Use a seeded property ID
        from api.app import api_list_properties
        props = json.loads(run(api_list_properties()).body)["properties"]
        pid = props[0]["property_id"]
        req = _make_request({})
        resp = run(api_update_property(req, pid, _PropertyUpdateRequest(title="New Title")))
        assert resp.status_code == 401

    def test_update_property_access_denied_for_other_user(self):
        """PUT /api/properties/:id as non-owner → 403."""
        import json
        from api.app import api_create_property, api_update_property, _PropertyCreateRequest, _PropertyUpdateRequest
        resp_data1, email1 = _register_user(name="Owner1", role="passenger")
        user_id1 = json.loads(resp_data1.body)["user_id"]
        _grant_posting_permission(user_id1)
        _, email2 = _register_user(name="Other1", role="passenger")
        session1 = _login_session(email1)
        req1 = _make_request(session1)
        pid = json.loads(run(api_create_property(req1, _PropertyCreateRequest(title="Owner1 Prop", lat=51.5, lng=-0.1))).body)["property"]["property_id"]

        session2 = _login_session(email2)
        req2 = _make_request(session2)
        resp = run(api_update_property(req2, pid, _PropertyUpdateRequest(title="Hacked!")))
        assert resp.status_code == 403

    def test_update_property_by_owner_ok(self):
        """PUT /api/properties/:id as owner should succeed."""
        import json
        from api.app import api_create_property, api_update_property, _PropertyCreateRequest, _PropertyUpdateRequest
        resp_data, email = _register_user(name="OwnerUpdate", role="passenger")
        user_id = json.loads(resp_data.body)["user_id"]
        _grant_posting_permission(user_id)
        session = _login_session(email)
        req = _make_request(session)
        pid = json.loads(run(api_create_property(req, _PropertyCreateRequest(title="Original Title", lat=51.5, lng=-0.1))).body)["property"]["property_id"]
        resp = run(api_update_property(req, pid, _PropertyUpdateRequest(title="Updated Title", status="sold")))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert data["property"]["title"] == "Updated Title"
        assert data["property"]["status"] == "sold"

    def test_delete_property_requires_login(self):
        """DELETE /api/properties/:id without login → 401."""
        import json
        from api.app import api_delete_property, api_list_properties
        props = json.loads(run(api_list_properties()).body)["properties"]
        pid = props[0]["property_id"]
        req = _make_request({})
        resp = run(api_delete_property(req, pid))
        assert resp.status_code == 401

    def test_delete_property_by_owner_ok(self):
        """DELETE /api/properties/:id as owner should succeed."""
        import json
        from api.app import api_create_property, api_delete_property, api_get_property, _PropertyCreateRequest
        resp_data, email = _register_user(name="OwnerDelete", role="passenger")
        user_id = json.loads(resp_data.body)["user_id"]
        _grant_posting_permission(user_id)
        session = _login_session(email)
        req = _make_request(session)
        pid = json.loads(run(api_create_property(req, _PropertyCreateRequest(title="To Delete", lat=51.5, lng=-0.1))).body)["property"]["property_id"]
        resp = run(api_delete_property(req, pid))
        assert resp.status_code == 200
        assert json.loads(resp.body)["ok"] is True
        # Should be gone
        assert run(api_get_property(pid)).status_code == 404

    def test_list_properties_map_bounds_filter(self):
        """GET /api/properties with bounds should filter by lat/lng."""
        import json
        from api.app import api_list_properties
        # Use tight bounds that won't contain any seeded London properties
        resp = run(api_list_properties(min_lat=0.0, max_lat=1.0, min_lng=0.0, max_lng=1.0))
        data = json.loads(resp.body)
        assert data["properties"] == []


class TestPropertyConversations:
    """Tests for /api/property_conversations and /api/property_messages endpoints."""

    def _register_and_get_id(self, prefix="PropConv"):
        resp, email = _register_user(name=prefix, role="passenger")
        session = _login_session(email)
        return session.get("app_user_id"), session, email

    def test_list_conversations_requires_login(self):
        """GET /api/property_conversations without login → 401."""
        from api.app import api_list_property_conversations
        req = _make_request({})
        resp = run(api_list_property_conversations(req))
        assert resp.status_code == 401

    def test_list_conversations_empty_for_new_user(self):
        """GET /api/property_conversations for a new user → empty list."""
        import json
        from api.app import api_list_property_conversations
        uid, session, _ = self._register_and_get_id("PCEmpty")
        req = _make_request(session)
        resp = run(api_list_property_conversations(req))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert data["conversations"] == []

    def test_start_conversation_requires_login(self):
        """POST /api/property_conversations without login → 401."""
        from api.app import api_start_property_conversation, _PropConvStartRequest
        req = _make_request({})
        resp = run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-1", agent_id="agent-1")))
        assert resp.status_code == 401

    def test_start_conversation_nonexistent_property(self):
        """POST /api/property_conversations with bad property_id → 404."""
        from api.app import api_start_property_conversation, _PropConvStartRequest
        uid, session, _ = self._register_and_get_id("PCBadProp")
        req = _make_request(session)
        resp = run(api_start_property_conversation(req, _PropConvStartRequest(property_id="no-such-prop", agent_id="agent-1")))
        assert resp.status_code == 404

    def test_start_conversation_nonexistent_agent(self):
        """POST /api/property_conversations with bad agent_id → 404."""
        from api.app import api_start_property_conversation, _PropConvStartRequest
        uid, session, _ = self._register_and_get_id("PCBadAgent")
        req = _make_request(session)
        resp = run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-1", agent_id="no-such-agent")))
        assert resp.status_code == 404

    def test_start_conversation_creates_conv(self):
        """POST /api/property_conversations should create a conversation."""
        import json
        from api.app import api_start_property_conversation, _PropConvStartRequest
        uid, session, _ = self._register_and_get_id("PCCreate")
        req = _make_request(session)
        resp = run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-1", agent_id="agent-1")))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert "conv" in data
        assert data["conv"]["property_id"] == "prop-1"
        assert data["conv"]["agent_id"] == "agent-1"
        assert data["conv"]["user_id"] == uid

    def test_start_conversation_idempotent(self):
        """Starting the same conversation twice should return the same conv_id."""
        import json
        from api.app import api_start_property_conversation, _PropConvStartRequest
        uid, session, _ = self._register_and_get_id("PCIdempotent")
        req = _make_request(session)
        body = _PropConvStartRequest(property_id="prop-2", agent_id="agent-2")
        conv1 = json.loads(run(api_start_property_conversation(req, body)).body)["conv"]["conv_id"]
        conv2 = json.loads(run(api_start_property_conversation(req, body)).body)["conv"]["conv_id"]
        assert conv1 == conv2

    def test_get_messages_requires_login(self):
        """GET /api/property_conversations/:id/messages without login → 401."""
        from api.app import api_get_property_messages
        req = _make_request({})
        resp = run(api_get_property_messages(req, "some-conv-id"))
        assert resp.status_code == 401

    def test_get_messages_not_found(self):
        """GET /api/property_conversations/nonexistent/messages → 404."""
        from api.app import api_get_property_messages
        uid, session, _ = self._register_and_get_id("PCMsgNotFound")
        req = _make_request(session)
        resp = run(api_get_property_messages(req, "nonexistent-conv"))
        assert resp.status_code == 404

    def test_get_messages_access_denied_for_non_participant(self):
        """GET messages as non-participant → 403."""
        import json
        from api.app import api_start_property_conversation, api_get_property_messages, _PropConvStartRequest
        uid1, s1, _ = self._register_and_get_id("PCAccess1")
        uid2, s2, _ = self._register_and_get_id("PCAccess2")
        conv_id = json.loads(run(api_start_property_conversation(_make_request(s1), _PropConvStartRequest(property_id="prop-1", agent_id="agent-1"))).body)["conv"]["conv_id"]
        resp = run(api_get_property_messages(_make_request(s2), conv_id))
        assert resp.status_code == 403

    def test_send_message_requires_login(self):
        """POST /api/property_messages without login → 401."""
        from api.app import api_send_property_message, _PropMsgSendRequest
        req = _make_request({})
        resp = run(api_send_property_message(req, _PropMsgSendRequest(conv_id="x", content="hi")))
        assert resp.status_code == 401

    def test_send_empty_message_rejected(self):
        """POST /api/property_messages with empty content → 400."""
        import json
        from api.app import api_start_property_conversation, api_send_property_message, _PropConvStartRequest, _PropMsgSendRequest
        uid, session, _ = self._register_and_get_id("PCEmpty2")
        req = _make_request(session)
        conv_id = json.loads(run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-1", agent_id="agent-3"))).body)["conv"]["conv_id"]
        resp = run(api_send_property_message(req, _PropMsgSendRequest(conv_id=conv_id, content="   ")))
        assert resp.status_code == 400

    def test_send_and_retrieve_message(self):
        """Send a message and retrieve it via GET messages."""
        import json
        from api.app import api_start_property_conversation, api_send_property_message, api_get_property_messages, _PropConvStartRequest, _PropMsgSendRequest
        uid, session, _ = self._register_and_get_id("PCSendRecv")
        req = _make_request(session)
        conv_id = json.loads(run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-1", agent_id="agent-1"))).body)["conv"]["conv_id"]
        run(api_send_property_message(req, _PropMsgSendRequest(conv_id=conv_id, content="Hello agent!")))
        msgs = json.loads(run(api_get_property_messages(req, conv_id)).body)["messages"]
        assert any(m["content"] == "Hello agent!" for m in msgs)

    def test_send_message_sets_sender_role_user(self):
        """Messages sent by the conversation user should have sender_role='user'."""
        import json
        from api.app import api_start_property_conversation, api_send_property_message, api_get_property_messages, _PropConvStartRequest, _PropMsgSendRequest
        uid, session, _ = self._register_and_get_id("PCSenderRole")
        req = _make_request(session)
        conv_id = json.loads(run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-2", agent_id="agent-2"))).body)["conv"]["conv_id"]
        run(api_send_property_message(req, _PropMsgSendRequest(conv_id=conv_id, content="Role check")))
        msgs = json.loads(run(api_get_property_messages(req, conv_id)).body)["messages"]
        msg = next(m for m in msgs if m["content"] == "Role check")
        assert msg["sender_role"] == "user"

    def test_conversation_listed_after_message(self):
        """After starting a conversation it should appear in the inbox list."""
        import json
        from api.app import api_start_property_conversation, api_list_property_conversations, _PropConvStartRequest
        uid, session, _ = self._register_and_get_id("PCListAfter")
        req = _make_request(session)
        conv_id = json.loads(run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-3", agent_id="agent-7"))).body)["conv"]["conv_id"]
        convs = json.loads(run(api_list_property_conversations(req)).body)["conversations"]
        assert any(c["conv_id"] == conv_id for c in convs)

    def test_mark_read_requires_login(self):
        """POST /api/property_conversations/:id/read without login → 401."""
        from api.app import api_property_conversation_read
        req = _make_request({})
        resp = run(api_property_conversation_read(req, "conv-id"))
        assert resp.status_code == 401

    def test_mark_read_resets_unread_count(self):
        """Marking a conversation read should reset unread_count to 0."""
        import json
        from api.app import (
            api_start_property_conversation, api_send_property_message,
            api_list_property_conversations, api_property_conversation_read,
            _PropConvStartRequest, _PropMsgSendRequest,
        )
        uid, session, _ = self._register_and_get_id("PCReadReset")
        req = _make_request(session)
        conv_id = json.loads(run(api_start_property_conversation(req, _PropConvStartRequest(property_id="prop-1", agent_id="agent-1"))).body)["conv"]["conv_id"]
        # Send a message as user (increments agent's unread)
        run(api_send_property_message(req, _PropMsgSendRequest(conv_id=conv_id, content="Mark read test")))
        # Mark read as user (resets user's unread which was not incremented, just verify ok)
        resp = run(api_property_conversation_read(req, conv_id))
        assert resp.status_code == 200
        assert json.loads(resp.body)["ok"] is True


# ---------------------------------------------------------------------------
# Unified Map Nearby endpoint
# ---------------------------------------------------------------------------

class TestUnifiedMapNearby:
    """Tests for GET /api/unified_map/nearby."""

    def test_drivers_mode_returns_correct_structure(self):
        """GET /api/unified_map/nearby?mode=drivers returns {"items": [...], "mode": "drivers"}."""
        import json
        from api.app import api_unified_map_nearby
        resp = run(api_unified_map_nearby(lat=51.5, lng=-0.1, radius_km=25.0, mode="drivers"))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "items" in body
        assert body["mode"] == "drivers"
        assert isinstance(body["items"], list)

    def test_properties_mode_returns_correct_structure(self):
        """GET /api/unified_map/nearby?mode=properties returns {"items": [...], "mode": "properties"}."""
        import json
        from api.app import api_unified_map_nearby
        resp = run(api_unified_map_nearby(lat=51.5, lng=-0.1, radius_km=25.0, mode="properties"))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "items" in body
        assert body["mode"] == "properties"
        assert isinstance(body["items"], list)

    def test_properties_sorted_by_distance(self):
        """Items in properties mode are sorted by distance_km ascending."""
        import json
        from api.app import api_unified_map_nearby
        resp = run(api_unified_map_nearby(lat=51.5, lng=-0.1, radius_km=500.0, mode="properties"))
        body = json.loads(resp.body)
        items = body["items"]
        if len(items) >= 2:
            distances = [item["distance_km"] for item in items]
            assert distances == sorted(distances), "Properties should be sorted by distance_km ascending"

    def test_properties_have_distance_km_field(self):
        """Each property item has a distance_km field."""
        import json
        from api.app import api_unified_map_nearby
        resp = run(api_unified_map_nearby(lat=51.5, lng=-0.1, radius_km=500.0, mode="properties"))
        body = json.loads(resp.body)
        for item in body["items"]:
            assert "distance_km" in item, f"Item missing distance_km: {item}"

    def test_drivers_no_active_returns_empty(self):
        """mode=drivers with no active drivers returns empty items list."""
        import json
        from api.app import api_unified_map_nearby, _driver_locations, _driver_loc_lock
        # Temporarily clear driver locations
        with _driver_loc_lock:
            saved = dict(_driver_locations)
            _driver_locations.clear()
        try:
            resp = run(api_unified_map_nearby(lat=51.5, lng=-0.1, radius_km=25.0, mode="drivers"))
            body = json.loads(resp.body)
            assert body["items"] == []
            assert body["mode"] == "drivers"
        finally:
            with _driver_loc_lock:
                _driver_locations.update(saved)


# ---------------------------------------------------------------------------
# iOS-friendly download endpoint
# ---------------------------------------------------------------------------

class TestIOSDownload:
    """Tests for the /downloads/{filename} endpoint iOS-friendly improvements."""

    def test_avi_mime_type(self):
        """download_file should return video/x-msvideo for .avi files."""
        import json
        from api.app import download_file, DOWNLOAD_FOLDER
        # Create a temporary .avi file in the download folder
        avi_path = os.path.join(DOWNLOAD_FOLDER, "test_ios.avi")
        os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
        with open(avi_path, "wb") as f:
            f.write(b"fake avi content")
        try:
            resp = run(download_file("test_ios.avi"))
            # Should use video/x-msvideo, not application/octet-stream
            assert resp.media_type == "video/x-msvideo", f"Expected video/x-msvideo, got {resp.media_type}"
        finally:
            if os.path.exists(avi_path):
                os.remove(avi_path)

    def test_mkv_mime_type(self):
        """download_file should return video/x-matroska for .mkv files."""
        from api.app import download_file, DOWNLOAD_FOLDER
        mkv_path = os.path.join(DOWNLOAD_FOLDER, "test_ios.mkv")
        os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
        with open(mkv_path, "wb") as f:
            f.write(b"fake mkv content")
        try:
            resp = run(download_file("test_ios.mkv"))
            assert resp.media_type == "video/x-matroska", f"Expected video/x-matroska, got {resp.media_type}"
        finally:
            if os.path.exists(mkv_path):
                os.remove(mkv_path)

    def test_mp4_mime_type(self):
        """download_file should return video/mp4 for .mp4 files."""
        from api.app import download_file, DOWNLOAD_FOLDER
        mp4_path = os.path.join(DOWNLOAD_FOLDER, "test_ios.mp4")
        os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
        with open(mp4_path, "wb") as f:
            f.write(b"fake mp4 content")
        try:
            resp = run(download_file("test_ios.mp4"))
            # Python's mimetypes correctly maps .mp4 to video/mp4
            assert "video/mp4" in resp.media_type, f"Expected video/mp4, got {resp.media_type}"
        finally:
            if os.path.exists(mp4_path):
                os.remove(mp4_path)

    def test_content_disposition_attachment(self):
        """download_file should set Content-Disposition: attachment."""
        from api.app import download_file, DOWNLOAD_FOLDER
        txt_path = os.path.join(DOWNLOAD_FOLDER, "test_ios.txt")
        os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
        with open(txt_path, "wb") as f:
            f.write(b"hello")
        try:
            resp = run(download_file("test_ios.txt"))
            disposition = resp.headers.get("content-disposition", "")
            assert "attachment" in disposition, f"Expected attachment in Content-Disposition, got: {disposition}"
            assert "test_ios.txt" in disposition, f"Expected filename in Content-Disposition, got: {disposition}"
        finally:
            if os.path.exists(txt_path):
                os.remove(txt_path)

    def test_ios_unsupported_header_for_avi(self):
        """download_file should set X-iOS-Unsupported: true for .avi files."""
        from api.app import download_file, DOWNLOAD_FOLDER
        avi_path = os.path.join(DOWNLOAD_FOLDER, "test_ios2.avi")
        os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
        with open(avi_path, "wb") as f:
            f.write(b"fake avi content")
        try:
            resp = run(download_file("test_ios2.avi"))
            assert resp.headers.get("x-ios-unsupported") == "true", \
                f"Expected X-iOS-Unsupported: true for .avi, got: {resp.headers.get('x-ios-unsupported')}"
        finally:
            if os.path.exists(avi_path):
                os.remove(avi_path)

    def test_ios_unsupported_header_absent_for_mp4(self):
        """download_file should NOT set X-iOS-Unsupported for .mp4 files (native support)."""
        from api.app import download_file, DOWNLOAD_FOLDER
        mp4_path = os.path.join(DOWNLOAD_FOLDER, "test_ios_mp4_ok.mp4")
        os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)
        with open(mp4_path, "wb") as f:
            f.write(b"fake mp4")
        try:
            resp = run(download_file("test_ios_mp4_ok.mp4"))
            assert resp.headers.get("x-ios-unsupported") is None, \
                "X-iOS-Unsupported should not be set for .mp4"
        finally:
            if os.path.exists(mp4_path):
                os.remove(mp4_path)

    def test_download_nonexistent_file_returns_404(self):
        """download_file should return 404 for a file that does not exist."""
        from api.app import download_file
        resp = run(download_file("definitely_does_not_exist.avi"))
        assert resp.status_code == 404

    def test_mime_overrides_contain_avi(self):
        """_MIME_OVERRIDES dict must include .avi → video/x-msvideo."""
        from api.app import _MIME_OVERRIDES
        assert ".avi" in _MIME_OVERRIDES
        assert _MIME_OVERRIDES[".avi"] == "video/x-msvideo"

    def test_mime_overrides_contain_mkv(self):
        """_MIME_OVERRIDES dict must include .mkv → video/x-matroska."""
        from api.app import _MIME_OVERRIDES
        assert ".mkv" in _MIME_OVERRIDES
        assert _MIME_OVERRIDES[".mkv"] == "video/x-matroska"

    def test_ios_unsupported_exts_contains_avi(self):
        """_IOS_UNSUPPORTED_EXTS must include .avi."""
        from api.app import _IOS_UNSUPPORTED_EXTS
        assert ".avi" in _IOS_UNSUPPORTED_EXTS

    def test_ios_unsupported_exts_contains_mkv(self):
        """_IOS_UNSUPPORTED_EXTS must include .mkv."""
        from api.app import _IOS_UNSUPPORTED_EXTS
        assert ".mkv" in _IOS_UNSUPPORTED_EXTS


# ---------------------------------------------------------------------------
# Property map preview endpoint (unauthenticated)
# ---------------------------------------------------------------------------

class TestPropertyMapPreview:
    """Tests for GET /api/properties/{id}/map_preview."""

    def test_returns_preview_for_valid_property(self):
        """GET /api/properties/prop-1/map_preview returns preview with lat/lng."""
        import json
        from api.app import api_property_map_preview
        resp = run(api_property_map_preview("prop-1"))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "preview" in body
        p = body["preview"]
        assert p["property_id"] == "prop-1"
        assert "lat" in p
        assert "lng" in p

    def test_preview_fields_are_minimal(self):
        """Preview should only include safe non-sensitive fields."""
        import json
        from api.app import api_property_map_preview
        resp = run(api_property_map_preview("prop-1"))
        body = json.loads(resp.body)
        p = body["preview"]
        # Must have location + basic metadata
        for field in ("property_id", "title", "address", "lat", "lng", "status"):
            assert field in p, f"Missing expected field: {field}"
        # Must NOT expose sensitive details requiring auth
        assert "description" not in p, "Description should not be in map_preview"
        assert "agents" not in p, "Agents should not be in map_preview"
        assert "price" not in p, "Price should not be in map_preview"

    def test_returns_404_for_unknown_property(self):
        """GET /api/properties/no-such-id/map_preview returns 404."""
        from api.app import api_property_map_preview
        resp = run(api_property_map_preview("no-such-id-xyz"))
        assert resp.status_code == 404

    def test_endpoint_does_not_require_auth(self):
        """map_preview is unauthenticated — no session/token needed."""
        import json
        from api.app import api_property_map_preview
        # Call without any session — should succeed
        resp = run(api_property_map_preview("prop-2"))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "preview" in body
        assert body["preview"]["property_id"] == "prop-2"

    def test_multiple_properties_each_have_preview(self):
        """All seeded properties should be accessible via map_preview."""
        import json
        from api.app import api_property_map_preview
        for pid in ("prop-1", "prop-2", "prop-3"):
            resp = run(api_property_map_preview(pid))
            assert resp.status_code == 200, f"Expected 200 for {pid}"
            body = json.loads(resp.body)
            assert body["preview"]["property_id"] == pid


# ---------------------------------------------------------------------------
# Bucket data storage helpers
# ---------------------------------------------------------------------------

class TestBucketWriteJson:
    """Tests for the _bucket_write_json helper."""

    def test_returns_false_when_s3_disabled(self):
        """_bucket_write_json should return False gracefully when S3 is not configured."""
        from api.app import _bucket_write_json, _S3_ENABLED
        # S3 is not configured in tests, so this must return False without raising
        result = _bucket_write_json("properties", "property", "test-id", {"key": "value"})
        assert result is False

    def test_key_format_uses_naming_convention(self, monkeypatch):
        """The generated S3 key should follow {folder}/{type}_{ts}_{id}.json."""
        import re
        from api import app as app_mod
        captured = []
        monkeypatch.setattr(app_mod, "_s3_upload_bytes", lambda data, key, ct="application/json": captured.append(key) or True)
        app_mod._bucket_write_json("rides", "ride", "abc123", {"ride_id": "abc123"})
        assert len(captured) == 1
        key = captured[0]
        # key format: rides/ride_{YYYYMMDD_HHMMSS}_abc123.json
        assert re.match(r"rides/ride_\d{8}_\d{6}_abc123\.json", key), f"Unexpected key: {key}"

    def test_payload_is_valid_json(self, monkeypatch):
        """The bytes written to S3 should be valid JSON."""
        import json
        from api import app as app_mod
        payloads = []
        monkeypatch.setattr(app_mod, "_s3_upload_bytes", lambda data, key, ct="application/json": payloads.append(data) or True)
        app_mod._bucket_write_json("notifications", "notification", "notif-1", {"foo": "bar"})
        assert len(payloads) == 1
        obj = json.loads(payloads[0])
        assert obj["foo"] == "bar"

    def test_content_type_is_json(self, monkeypatch):
        """The content-type passed to _s3_upload_bytes should be application/json."""
        from api import app as app_mod
        cts = []
        monkeypatch.setattr(app_mod, "_s3_upload_bytes", lambda data, key, ct="application/json": cts.append(ct) or True)
        app_mod._bucket_write_json("stats", "stats", "20250329", {"total": 5})
        assert cts[0] == "application/json"

    def test_folder_prefix_in_key(self, monkeypatch):
        """The key must start with the folder name."""
        from api import app as app_mod
        keys = []
        monkeypatch.setattr(app_mod, "_s3_upload_bytes", lambda data, key, ct="application/json": keys.append(key) or True)
        app_mod._bucket_write_json("driver_reg/pending", "driver_reg", "app-1", {})
        assert keys[0].startswith("driver_reg/pending/")


# ---------------------------------------------------------------------------
# Platform stats endpoint
# ---------------------------------------------------------------------------

class TestPlatformStats:
    """Tests for GET /api/platform_stats."""

    def test_returns_200(self):
        import json
        from api.app import api_platform_stats
        resp = run(api_platform_stats())
        assert resp.status_code == 200

    def test_response_has_required_fields(self):
        import json
        from api.app import api_platform_stats
        resp = run(api_platform_stats())
        data = json.loads(resp.body)
        for field in ("total_rides", "open_rides", "total_properties", "active_properties",
                      "registered_drivers", "pending_driver_applications",
                      "total_users", "total_notifications", "generated_at"):
            assert field in data, f"Missing field: {field}"

    def test_counts_are_non_negative(self):
        import json
        from api.app import api_platform_stats
        data = json.loads(run(api_platform_stats()).body)
        for field in ("total_rides", "open_rides", "total_properties", "active_properties",
                      "registered_drivers", "pending_driver_applications",
                      "total_users", "total_notifications"):
            assert data[field] >= 0, f"{field} should be >= 0"

    def test_total_rides_increases_after_post(self):
        """Posting a ride should increment total_rides."""
        import json
        from api.app import api_platform_stats, api_ride_post, _RidePostRequest
        before = json.loads(run(api_platform_stats()).body)["total_rides"]
        resp, email = _register_driver("StatsRideUser")
        user_id = json.loads(resp.body)["user_id"]
        session = {"app_user_id": user_id}
        req = _make_request(session)
        run(api_ride_post(req, _RidePostRequest(
            origin="Airport", destination="City", departure="2025-12-01T10:00", seats=2,
        )))
        after = json.loads(run(api_platform_stats()).body)["total_rides"]
        assert after == before + 1

    def test_total_users_increases_after_register(self):
        """Registering a user should increment total_users."""
        import json
        from api.app import api_platform_stats
        before = json.loads(run(api_platform_stats()).body)["total_users"]
        _register_user("StatsNewUser")
        after = json.loads(run(api_platform_stats()).body)["total_users"]
        assert after == before + 1

    def test_bucket_write_called_on_stats(self, monkeypatch):
        """platform_stats should attempt to write a stats JSON to the bucket."""
        from api import app as app_mod
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        run(app_mod.api_platform_stats())
        assert any(c == "stats" for c in calls), "Expected a bucket write to 'stats' folder"

    def test_generated_at_is_iso_format(self):
        """generated_at should be a valid ISO-8601 timestamp."""
        import json
        from datetime import datetime, timezone
        from api.app import api_platform_stats
        data = json.loads(run(api_platform_stats()).body)
        ts = data["generated_at"]
        # Should not raise
        datetime.fromisoformat(ts)


# ---------------------------------------------------------------------------
# Bucket sync on ride post
# ---------------------------------------------------------------------------

class TestRideBucketSync:
    """Verify that ride operations write to the bucket."""

    def test_ride_post_writes_to_bucket(self, monkeypatch):
        import json
        from api import app as app_mod
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append((folder, tp)) or False)
        resp, _ = _register_driver("RideBucket")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        run(app_mod.api_ride_post(req, app_mod._RidePostRequest(
            origin="Airport", destination="Hotel", departure="2025-11-01T08:00", seats=1,
        )))
        folders = [f for f, _ in calls]
        assert "rides" in folders

    def test_ride_cancel_writes_to_bucket(self, monkeypatch):
        import json
        from api import app as app_mod
        resp, _ = _register_driver("RideCancelBucket")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        r = run(app_mod.api_ride_post(req, app_mod._RidePostRequest(
            origin="X", destination="Y", departure="2025-11-01T09:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        run(app_mod.api_ride_cancel(_make_request({"app_user_id": user_id}), ride_id))
        assert "rides" in calls

    def test_ride_take_writes_to_rides_and_history(self, monkeypatch):
        import json
        from api import app as app_mod
        resp, _ = _register_driver("RideTakeBucket")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        r = run(app_mod.api_ride_post(req, app_mod._RidePostRequest(
            origin="A", destination="B", departure="2025-11-01T10:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        run(app_mod.api_ride_take(_make_request({"app_user_id": user_id}), ride_id))
        assert "rides" in calls
        assert "history" in calls


# ---------------------------------------------------------------------------
# Bucket sync on property create/update
# ---------------------------------------------------------------------------

class TestPropertyBucketSync:
    """Verify that property operations write to the bucket."""

    def test_create_property_writes_to_bucket(self, monkeypatch):
        import json
        from api import app as app_mod
        resp, _ = _register_user("PropBucket")
        user_id = json.loads(resp.body)["user_id"]
        _grant_posting_permission(user_id)
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        req = _make_request({"app_user_id": user_id})
        run(app_mod.api_create_property(req, app_mod._PropertyCreateRequest(
            title="Test House",
            description="Nice house",
            price=100000,
            address="1 Main St",
            lat=51.5,
            lng=-0.1,
            status="active",
        )))
        assert "properties" in calls

    def test_update_property_writes_to_bucket(self, monkeypatch):
        import json
        from api import app as app_mod
        resp, _ = _register_user("PropUpdateBucket")
        user_id = json.loads(resp.body)["user_id"]
        _grant_posting_permission(user_id)
        req = _make_request({"app_user_id": user_id})
        r = run(app_mod.api_create_property(req, app_mod._PropertyCreateRequest(
            title="Old Title",
            description="desc",
            price=50000,
            address="2 Side St",
            lat=51.6,
            lng=-0.2,
            status="active",
        )))
        prop_id = json.loads(r.body)["property"]["property_id"]
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        run(app_mod.api_update_property(req, prop_id, app_mod._PropertyUpdateRequest(title="New Title")))
        assert "properties" in calls


# ---------------------------------------------------------------------------
# Bucket sync on driver registration
# ---------------------------------------------------------------------------

class TestDriverRegBucketSync:
    """Verify that driver registration writes to the correct bucket folders."""

    def test_apply_writes_to_driver_reg_pending(self, monkeypatch):
        import json
        from api import app as app_mod
        resp, _ = _register_user("DriverRegBucket")
        user_id = json.loads(resp.body)["user_id"]
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        req = _make_request({"app_user_id": user_id})
        run(app_mod.api_driver_apply(req, app_mod._DriverApplyRequest(
            vehicle_make="Toyota",
            vehicle_model="Corolla",
            vehicle_year=2020,
            vehicle_color="White",
            license_plate="XYZ789",
        )))
        assert "driver_reg/pending" in calls

    def test_approve_writes_to_driver_reg_verified(self, monkeypatch):
        import json
        import uuid as _uuid
        from api import app as app_mod
        resp, _ = _register_user("DriverApproveBucket")
        user_id = json.loads(resp.body)["user_id"]
        # Insert an application directly
        from api.app import _get_db, _db_lock, USE_POSTGRES
        from datetime import datetime, timezone
        app_id = str(_uuid.uuid4())
        created = datetime.now(timezone.utc).isoformat()
        with _db_lock:
            conn = _get_db()
            try:
                if USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (app_id, user_id, "Honda", "Civic", 2019, "Red", "AA1234", created),
                    )
                else:
                    conn.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (app_id, user_id, "Honda", "Civic", 2019, "Red", "AA1234", created),
                    )
                conn.commit()
            finally:
                conn.close()
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        admin_req = _make_request({"admin_user": "admin"})
        run(app_mod.api_admin_driver_approve(admin_req, app_id, app_mod._DriverApproveRequest(approved=True)))
        assert "driver_reg/verified" in calls


# ---------------------------------------------------------------------------
# Bucket sync on notification create
# ---------------------------------------------------------------------------

class TestNotificationBucketSync:
    """Verify that _create_notification writes to the notifications bucket folder."""

    def test_create_notification_writes_to_bucket(self, monkeypatch):
        import json
        from api import app as app_mod
        resp, _ = _register_user("NotifBucket")
        user_id = json.loads(resp.body)["user_id"]
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        app_mod._create_notification(user_id, "test", "Title", "Body")
        assert "notifications" in calls

    def test_notification_bucket_payload_has_read_status(self, monkeypatch):
        import json
        from api import app as app_mod
        resp, _ = _register_user("NotifBucketPayload")
        user_id = json.loads(resp.body)["user_id"]
        payloads = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: payloads.append(data) or False)
        app_mod._create_notification(user_id, "test", "Hi", "Body")
        assert len(payloads) >= 1
        assert payloads[0].get("read_status") is False


# ---------------------------------------------------------------------------
# E2E public key endpoints
# ---------------------------------------------------------------------------

class TestPublicKeyEndpoints:
    """Tests for PUT /api/auth/public_key and GET /api/users/{user_id}/public_key."""

    def test_store_public_key_requires_login(self):
        """PUT /api/auth/public_key without login → 401."""
        from api.app import api_store_public_key, _StorePublicKeyRequest
        req = _make_request({})
        resp = run(api_store_public_key(req, _StorePublicKeyRequest(public_key="abc")))
        assert resp.status_code == 401

    def test_store_public_key_rejects_empty(self):
        """PUT /api/auth/public_key with empty key → 400."""
        from api.app import api_store_public_key, _StorePublicKeyRequest
        resp_data, email = _register_user(name="PKEmpty")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_store_public_key(req, _StorePublicKeyRequest(public_key="   ")))
        assert resp.status_code == 400

    def test_store_and_retrieve_public_key(self):
        """Store a public key and retrieve it via GET /api/users/{id}/public_key."""
        import json
        from api.app import api_store_public_key, api_get_user_public_key, _StorePublicKeyRequest
        resp_data, email = _register_user(name="PKUser")
        user_id = json.loads(resp_data.body)["user_id"]
        session = _login_session(email)
        req = _make_request(session)

        pk_value = '{"kty":"EC","crv":"P-256","x":"test","y":"test"}'
        store_resp = run(api_store_public_key(req, _StorePublicKeyRequest(public_key=pk_value)))
        assert store_resp.status_code == 200
        assert json.loads(store_resp.body)["ok"] is True

        # Another logged-in user can retrieve it
        resp_data2, email2 = _register_user(name="PKRetriever")
        session2 = _login_session(email2)
        req2 = _make_request(session2)
        get_resp = run(api_get_user_public_key(req2, user_id))
        assert get_resp.status_code == 200
        data = json.loads(get_resp.body)
        assert data["public_key"] == pk_value
        assert data["user_id"] == user_id

    def test_get_public_key_requires_login(self):
        """GET /api/users/{id}/public_key without login → 401."""
        from api.app import api_get_user_public_key
        req = _make_request({})
        resp = run(api_get_user_public_key(req, "some-user-id"))
        assert resp.status_code == 401

    def test_get_public_key_not_found(self):
        """GET /api/users/nonexistent/public_key → 404."""
        from api.app import api_get_user_public_key
        resp_data, email = _register_user(name="PKNotFoundCaller")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_get_user_public_key(req, "nonexistent-user-xyz"))
        assert resp.status_code == 404

    def test_public_key_stored_in_user_profile(self):
        """After storing a public key, api_user_me should include public_key."""
        import json
        from api.app import api_store_public_key, api_user_me, _StorePublicKeyRequest
        resp_data, email = _register_user(name="PKProfile")
        session = _login_session(email)
        req = _make_request(session)
        pk_value = '{"kty":"EC","crv":"P-256","x":"abc","y":"def"}'
        run(api_store_public_key(req, _StorePublicKeyRequest(public_key=pk_value)))
        me_resp = run(api_user_me(req))
        data = json.loads(me_resp.body)
        assert data.get("public_key") == pk_value


# ---------------------------------------------------------------------------
# Agent application endpoints
# ---------------------------------------------------------------------------

class TestAgentApplications:
    """Tests for agent registration: POST /api/agent_applications,
    GET /api/agent_applications/status, GET /api/admin/agent_applications,
    POST /api/admin/agent_applications/{id}/approve."""

    def test_submit_requires_login(self):
        """POST /api/agent_applications without login → 401."""
        from api.app import api_agent_apply, _AgentApplyRequest
        req = _make_request({})
        resp = run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Jane", email="j@x.com", license_number="LIC-1"
        )))
        assert resp.status_code == 401

    def test_submit_missing_full_name(self):
        """POST /api/agent_applications without full_name → 400."""
        from api.app import api_agent_apply, _AgentApplyRequest
        resp_data, email = _register_user(name="AgentNoName")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_agent_apply(req, _AgentApplyRequest(
            full_name="  ", email="j@x.com", license_number="LIC-1"
        )))
        assert resp.status_code == 400

    def test_submit_missing_license(self):
        """POST /api/agent_applications without license_number → 400."""
        from api.app import api_agent_apply, _AgentApplyRequest
        resp_data, email = _register_user(name="AgentNoLic")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Jane Smith", email="j@x.com", license_number=""
        )))
        assert resp.status_code == 400

    def test_submit_ok(self):
        """POST /api/agent_applications with valid data → 201 with app_id."""
        import json
        from api.app import api_agent_apply, _AgentApplyRequest
        resp_data, email = _register_user(name="AgentOK")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Jane Smith",
            email="jane@agency.com",
            phone="+1 555 000 1234",
            agency_name="Smith Realty",
            license_number="REA-999",
        )))
        assert resp.status_code == 201
        data = json.loads(resp.body)
        assert data["ok"] is True
        assert "app_id" in data

    def test_status_requires_login(self):
        """GET /api/agent_applications/status without login → 401."""
        from api.app import api_agent_application_status
        req = _make_request({})
        resp = run(api_agent_application_status(req))
        assert resp.status_code == 401

    def test_status_none_before_applying(self):
        """GET /api/agent_applications/status returns null for a new user."""
        import json
        from api.app import api_agent_application_status
        resp_data, email = _register_user(name="AgentNoApp")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_agent_application_status(req))
        assert resp.status_code == 200
        assert json.loads(resp.body)["application"] is None

    def test_status_pending_after_submit(self):
        """After submitting an application, status should be 'pending'."""
        import json
        from api.app import api_agent_apply, api_agent_application_status, _AgentApplyRequest
        resp_data, email = _register_user(name="AgentPending")
        session = _login_session(email)
        req = _make_request(session)
        run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Bob Pending", email="bob@x.com", license_number="LIC-P"
        )))
        resp = run(api_agent_application_status(req))
        data = json.loads(resp.body)
        assert data["application"]["status"] == "pending"
        assert data["application"]["license_number"] == "LIC-P"

    def test_admin_list_requires_admin(self):
        """GET /api/admin/agent_applications without admin session → 401."""
        from api.app import api_admin_agent_applications
        req = _make_request({})
        resp = run(api_admin_agent_applications(req))
        assert resp.status_code == 401

    def test_admin_list_returns_applications(self):
        """GET /api/admin/agent_applications with admin session returns list."""
        import json
        from api.app import api_agent_apply, api_admin_agent_applications, _AgentApplyRequest
        resp_data, email = _register_user(name="AgentForAdmin")
        session = _login_session(email)
        req = _make_request(session)
        run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Admin Listed", email="al@x.com", license_number="LIC-AL"
        )))
        admin_req = _make_request({"admin_user": "admin"})
        resp = run(api_admin_agent_applications(admin_req))
        assert resp.status_code == 200
        data = json.loads(resp.body)
        assert isinstance(data["applications"], list)
        assert any(a["license_number"] == "LIC-AL" for a in data["applications"])

    def test_approve_grants_posting_permission(self):
        """Approving an agent sets can_post_properties=1 and creates a notification."""
        import json
        from api.app import (api_agent_apply, api_admin_agent_approve, api_agent_application_status,
                              api_get_notifications, _AgentApplyRequest, _AgentApproveRequest)
        resp_data, email = _register_user(name="AgentApprove")
        user_id = json.loads(resp_data.body)["user_id"]
        session = _login_session(email)
        req = _make_request(session)
        apply_resp = run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Approvable Agent", email="approve@x.com", license_number="LIC-APP"
        )))
        app_id = json.loads(apply_resp.body)["app_id"]

        admin_req = _make_request({"admin_user": "admin"})
        approve_resp = run(api_admin_agent_approve(admin_req, app_id, _AgentApproveRequest(approved=True)))
        assert approve_resp.status_code == 200
        assert json.loads(approve_resp.body)["status"] == "approved"

        # Status should now be approved
        status_resp = run(api_agent_application_status(req))
        assert json.loads(status_resp.body)["application"]["status"] == "approved"

        # User should now have can_post_properties flag
        from api.app import _get_app_user
        user = _get_app_user(user_id)
        assert user["can_post_properties"] == 1

        # Notification should be created
        notif_resp = run(api_get_notifications(req))
        notifs = json.loads(notif_resp.body)["notifications"]
        assert any(n["type"] == "agent_approved" for n in notifs)

    def test_reject_does_not_grant_posting_permission(self):
        """Rejecting an agent does NOT set can_post_properties."""
        import json
        from api.app import (api_agent_apply, api_admin_agent_approve, api_get_notifications,
                              _AgentApplyRequest, _AgentApproveRequest, _get_app_user)
        resp_data, email = _register_user(name="AgentReject")
        user_id = json.loads(resp_data.body)["user_id"]
        session = _login_session(email)
        req = _make_request(session)
        apply_resp = run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Rejectable Agent", email="reject@x.com", license_number="LIC-REJ"
        )))
        app_id = json.loads(apply_resp.body)["app_id"]

        admin_req = _make_request({"admin_user": "admin"})
        reject_resp = run(api_admin_agent_approve(admin_req, app_id, _AgentApproveRequest(approved=False)))
        assert reject_resp.status_code == 200
        assert json.loads(reject_resp.body)["status"] == "rejected"

        user = _get_app_user(user_id)
        assert not user["can_post_properties"]

        notif_resp = run(api_get_notifications(req))
        notifs = json.loads(notif_resp.body)["notifications"]
        assert any(n["type"] == "agent_rejected" for n in notifs)

    def test_approve_nonexistent_application(self):
        """Approving a non-existent application → 404."""
        from api.app import api_admin_agent_approve, _AgentApproveRequest
        admin_req = _make_request({"admin_user": "admin"})
        resp = run(api_admin_agent_approve(admin_req, "nonexistent-app-xyz", _AgentApproveRequest(approved=True)))
        assert resp.status_code == 404

    def test_approved_agent_can_post_property(self):
        """An approved agent (can_post_properties=1) can create a property."""
        import json
        from api.app import (api_agent_apply, api_admin_agent_approve, api_create_property,
                              _AgentApplyRequest, _AgentApproveRequest, _PropertyCreateRequest)
        resp_data, email = _register_user(name="PostingAgent")
        user_id = json.loads(resp_data.body)["user_id"]
        session = _login_session(email)
        req = _make_request(session)
        apply_resp = run(api_agent_apply(req, _AgentApplyRequest(
            full_name="Posting Agent", email="post@x.com", license_number="LIC-POST"
        )))
        app_id = json.loads(apply_resp.body)["app_id"]

        admin_req = _make_request({"admin_user": "admin"})
        run(api_admin_agent_approve(admin_req, app_id, _AgentApproveRequest(approved=True)))

        prop_resp = run(api_create_property(req, _PropertyCreateRequest(
            title="Agent Property",
            description="Listed by approved agent",
            price=2000.0,
            address="10 Agent Lane",
            lat=51.5,
            lng=-0.12,
            status="active",
        )))
        assert prop_resp.status_code == 201

    def test_property_requires_lat_lng(self):
        """POST /api/properties without lat/lng → 400."""
        import json
        from api.app import api_create_property, _PropertyCreateRequest
        resp_data, email = _register_user(name="PropNoPin")
        user_id = json.loads(resp_data.body)["user_id"]
        _grant_posting_permission(user_id)
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_create_property(req, _PropertyCreateRequest(
            title="No Pin Property",
            status="active",
        )))
        assert resp.status_code == 400

    def test_agent_reg_bucket_sync(self, monkeypatch):
        """Submitting an agent application writes to agent_reg/pending bucket."""
        import json
        from api import app as app_mod
        resp_data, email = _register_user("AgentBucket")
        user_id = json.loads(resp_data.body)["user_id"]
        calls = []
        monkeypatch.setattr(app_mod, "_bucket_write_json",
                            lambda folder, tp, rid, data: calls.append(folder) or False)
        req = _make_request({"app_user_id": user_id})
        run(app_mod.api_agent_apply(req, app_mod._AgentApplyRequest(
            full_name="Bucket Test Agent", email="bucket@x.com", license_number="LIC-B"
        )))
        assert "agent_reg/pending" in calls
