"""Tests for the platform features:
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
    _haversine_km,
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
    api_ride_alert_clients,
    api_ride_confirm_journey,
    api_ride_confirmed_users,
    api_ride_proximity_notify,
    api_create_ride_request,
    api_list_ride_requests,
    api_accept_ride_request,
    api_cancel_ride_request,
    api_create_travel_companion,
    api_list_travel_companions,
    api_delete_travel_companion,
    _JourneyConfirmRequest,
    _ProximityNotifyRequest,
    _RideRequestCreate,
    _TravelCompanionCreate,
    api_driver_dashboard,
    api_get_ride,
    api_verify_email,
    api_forgot_password,
    api_reset_password,
    _ForgotPasswordRequest,
    _ResetPasswordRequest,
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
# Geometry helpers
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
            admin_req = _make_request({"admin_logged_in": True})
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
# Alert clients endpoint
# ---------------------------------------------------------------------------

class TestRideAlertClients:
    """Tests for POST /api/rides/{ride_id}/alert_clients"""

    def test_alert_clients_not_logged_in_returns_401(self):
        req = _make_request({})
        resp = run(api_ride_alert_clients(req, "some-ride-id"))
        assert resp.status_code == 401

    def test_alert_clients_non_driver_returns_403(self):
        import json
        _, email = _register_user("AlertPassenger")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_alert_clients(req, "some-ride-id"))
        assert resp.status_code == 403

    def test_alert_clients_nonexistent_ride_returns_404(self):
        import json
        _, email = _register_driver("AlertDriverNoRide")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_alert_clients(req, "nonexistent-ride-xyz"))
        assert resp.status_code == 404

    def test_alert_clients_wrong_owner_returns_403(self):
        import json
        _, email1 = _register_driver("AlertOwner")
        session1 = _login_session(email1)
        req1 = _make_request(session1)
        r = run(api_ride_post(req1, _RidePostRequest(
            origin="AlertSrc", destination="AlertDst",
            departure="2032-01-01T10:00", seats=1,
        )))
        ride_id = json.loads(r.body)["ride_id"]

        _, email2 = _register_driver("AlertOtherDriver")
        session2 = _login_session(email2)
        req2 = _make_request(session2)
        resp = run(api_ride_alert_clients(req2, ride_id))
        assert resp.status_code == 403

    def test_alert_clients_no_passengers_returns_ok_with_zero(self):
        import json
        _, email = _register_driver("AlertDriverEmpty")
        session = _login_session(email)
        req = _make_request(session)
        r = run(api_ride_post(req, _RidePostRequest(
            origin="AlertSrcEmpty", destination="AlertDstEmpty",
            departure="2032-02-01T10:00", seats=2,
        )))
        ride_id = json.loads(r.body)["ride_id"]
        resp = run(api_ride_alert_clients(req, ride_id))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert body["alerted"] == 0


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
        session = {"admin_logged_in": True}
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

        admin_req = _make_request({"admin_logged_in": True})
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
        # Auto-response removed: only the passenger's message is broadcast.
        assert len(msgs) == 1
        payload = msgs[0][1]
        assert payload["ride_id"] == ride_id
        assert payload["name"]    == "Bob"
        assert payload["text"]    == "Hello, anyone there?"
        assert msgs[0][2]         == f"ride_chat_{ride_id}"

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
        # Auto-response removed: only the passenger's (truncated) message is broadcast.
        assert len(msgs) == 1
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
        # Auto-response removed: only the passenger's message (with stripped media_type) is broadcast.
        assert len(msgs) == 1
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

        admin_req = _make_request({"admin_logged_in": True})
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

        admin_req = _make_request({"admin_logged_in": True})
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

    def test_driver_approve_sends_confirmation_email(self, monkeypatch):
        """Approving a driver application triggers _send_email to the driver."""
        import json, uuid as _uuid, datetime as _dt
        from api import app as app_mod
        emails_sent = []
        monkeypatch.setattr(app_mod, "_send_email",
                            lambda to, subj, body: emails_sent.append((to, subj)) or True)
        resp, _ = _register_user("EmailDriverApprove")
        user_id = json.loads(resp.body)["user_id"]
        # Insert a driver application directly
        app_id = str(_uuid.uuid4())
        created = _dt.datetime.utcnow().isoformat()
        with app_mod._db_lock:
            conn = app_mod._get_db()
            try:
                if app_mod.USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (app_id, user_id, "Toyota", "Camry", 2020, "Blue", "EMAI001", created)
                    )
                else:
                    conn.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (app_id, user_id, "Toyota", "Camry", 2020, "Blue", "EMAI001", created)
                    )
                conn.commit()
            finally:
                conn.close()
        admin_req = _make_request({"admin_logged_in": True})
        run(app_mod.api_admin_driver_approve(admin_req, app_id, app_mod._DriverApproveRequest(approved=True)))
        assert len(emails_sent) == 1
        _, subject = emails_sent[0]
        assert "Approved" in subject

    def test_driver_reject_sends_rejection_email(self, monkeypatch):
        """Rejecting a driver application triggers _send_email to the driver."""
        import json, uuid as _uuid, datetime as _dt
        from api import app as app_mod
        emails_sent = []
        monkeypatch.setattr(app_mod, "_send_email",
                            lambda to, subj, body: emails_sent.append((to, subj)) or True)
        resp, _ = _register_user("EmailDriverReject")
        user_id = json.loads(resp.body)["user_id"]
        app_id = str(_uuid.uuid4())
        created = _dt.datetime.utcnow().isoformat()
        with app_mod._db_lock:
            conn = app_mod._get_db()
            try:
                if app_mod.USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (app_id, user_id, "Toyota", "Camry", 2020, "Blue", "EMAI002", created)
                    )
                else:
                    conn.execute(
                        "INSERT INTO driver_applications (app_id,user_id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (app_id, user_id, "Toyota", "Camry", 2020, "Blue", "EMAI002", created)
                    )
                conn.commit()
            finally:
                conn.close()
        admin_req = _make_request({"admin_logged_in": True})
        run(app_mod.api_admin_driver_approve(admin_req, app_id, app_mod._DriverApproveRequest(approved=False)))
        assert len(emails_sent) == 1
        _, subject = emails_sent[0]
        assert "Not Approved" in subject


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
        admin_req = _make_request({"admin_logged_in": True})
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
        for field in ("total_rides", "open_rides",
                      "registered_drivers", "pending_driver_applications",
                      "total_users", "total_notifications", "generated_at"):
            assert field in data, f"Missing field: {field}"

    def test_counts_are_non_negative(self):
        import json
        from api.app import api_platform_stats
        data = json.loads(run(api_platform_stats()).body)
        for field in ("total_rides", "open_rides",
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
        admin_req = _make_request({"admin_logged_in": True})
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

class TestAdminUsers:
    """Tests for GET /api/admin/users and DELETE /api/admin/users/{id}."""

    def test_list_requires_admin(self):
        from api.app import api_admin_users
        req = _make_request({})
        resp = run(api_admin_users(req))
        assert resp.status_code == 401

    def test_list_returns_users(self):
        import json
        from api.app import api_admin_users
        resp_user, _ = _register_user(name="AdminListableUser")
        registered_id = json.loads(resp_user.body)["user_id"]

        admin_req = _make_request({"admin_logged_in": True})
        resp = run(api_admin_users(admin_req))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "users" in body
        ids = [u["user_id"] for u in body["users"]]
        assert registered_id in ids

    def test_list_includes_expected_fields(self):
        import json
        from api.app import api_admin_users
        admin_req = _make_request({"admin_logged_in": True})
        resp = run(api_admin_users(admin_req))
        body = json.loads(resp.body)
        if body["users"]:
            user = body["users"][0]
            for field in ("user_id", "name", "email", "role", "can_post_properties", "created_at"):
                assert field in user

    def test_delete_requires_admin(self):
        from api.app import api_admin_delete_user
        req = _make_request({})
        resp = run(api_admin_delete_user(req, "fake-user-id"))
        assert resp.status_code == 401

    def test_delete_nonexistent_returns_404(self):
        from api.app import api_admin_delete_user
        req = _make_request({"admin_logged_in": True})
        resp = run(api_admin_delete_user(req, "does-not-exist"))
        assert resp.status_code == 404

    def test_admin_can_delete_user(self):
        import json
        from api.app import api_admin_users, api_admin_delete_user
        resp_user, _ = _register_user(name="DeleteableUser")
        user_id = json.loads(resp_user.body)["user_id"]

        admin_req = _make_request({"admin_logged_in": True})
        del_resp = run(api_admin_delete_user(admin_req, user_id))
        assert del_resp.status_code == 200
        assert json.loads(del_resp.body)["ok"] is True

        # Confirm gone
        list_resp = run(api_admin_users(admin_req))
        ids = [u["user_id"] for u in json.loads(list_resp.body)["users"]]
        assert user_id not in ids


# ---------------------------------------------------------------------------
# Admin — Broadcasts
# ---------------------------------------------------------------------------

class TestAdminBroadcasts:
    """Tests for GET /api/admin/broadcasts and DELETE /api/admin/broadcasts/{id}."""

    def test_list_requires_admin(self):
        from api.app import api_admin_broadcasts
        req = _make_request({})
        resp = run(api_admin_broadcasts(req))
        assert resp.status_code == 401

    def test_list_returns_broadcasts(self):
        import json
        from api.app import api_admin_broadcasts, api_broadcast_post, _BroadcastPostRequest
        resp_user, email = _register_user(name="BcastAdminUser")
        session = _login_session(email)
        req_user = _make_request(session)
        bcast_resp = run(api_broadcast_post(req_user, _BroadcastPostRequest(
            seats=2,
            waiting_time="30 min",
            start_destination="Airport",
            end_destination="City Centre",
        )))
        assert bcast_resp.status_code == 201
        bcast_id = json.loads(bcast_resp.body)["broadcast_id"]

        admin_req = _make_request({"admin_logged_in": True})
        resp = run(api_admin_broadcasts(admin_req))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "broadcasts" in body
        ids = [b["broadcast_id"] for b in body["broadcasts"]]
        assert bcast_id in ids

    def test_cancel_requires_admin(self):
        from api.app import api_admin_delete_broadcast
        req = _make_request({})
        resp = run(api_admin_delete_broadcast(req, "fake-id"))
        assert resp.status_code == 401

    def test_cancel_nonexistent_returns_404(self):
        from api.app import api_admin_delete_broadcast
        req = _make_request({"admin_logged_in": True})
        resp = run(api_admin_delete_broadcast(req, "does-not-exist"))
        assert resp.status_code == 404

    def test_admin_can_cancel_any_broadcast(self):
        import json
        from api.app import api_admin_broadcasts, api_admin_delete_broadcast, api_broadcast_post, _BroadcastPostRequest
        resp_user, email = _register_user(name="BcastCancelUser")
        session = _login_session(email)
        req_user = _make_request(session)
        bcast_resp = run(api_broadcast_post(req_user, _BroadcastPostRequest(
            seats=1,
            waiting_time="15 min",
            start_destination="North",
            end_destination="South",
        )))
        bcast_id = json.loads(bcast_resp.body)["broadcast_id"]

        admin_req = _make_request({"admin_logged_in": True})
        del_resp = run(api_admin_delete_broadcast(admin_req, bcast_id))
        assert del_resp.status_code == 200
        assert json.loads(del_resp.body)["ok"] is True

        # Confirm status is expired
        list_resp = run(api_admin_broadcasts(admin_req))
        bcasts = json.loads(list_resp.body)["broadcasts"]
        found = next((b for b in bcasts if b["broadcast_id"] == bcast_id), None)
        assert found is not None
        assert found["status"] == "expired"


# ===========================================================================
# Username field and user search by username
# ===========================================================================

class TestUsernameField:
    """Tests for the username column on app_users and user search by username."""

    def _register_and_get(self, name="UsernameUser"):
        resp, email = _register_user(name=name)
        import json
        data = json.loads(resp.body)
        return data, email

    def test_register_returns_username(self):
        """Registration response includes username derived from email prefix."""
        import json
        data, email = self._register_and_get("UsernameReg")
        assert "username" in data
        assert data["username"]  # non-empty

    def test_username_derived_from_email(self):
        """Auto-generated username matches the email prefix."""
        import json
        import re as _re
        resp, email = _register_user(name="UsernameDerive")
        data = json.loads(resp.body)
        email_prefix = _re.sub(r"[^a-z0-9_.-]", "", email.split("@")[0].lower())
        # username should equal the email prefix or start with it (suffix appended for uniqueness)
        assert data["username"] == email_prefix or data["username"].startswith(email_prefix)

    def test_me_endpoint_returns_username(self):
        """GET /api/auth/me includes username in response."""
        import json
        from api.app import api_user_me, _get_db, _db_lock, USE_POSTGRES, _execute
        resp, email = _register_user(name="MeUsername")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        me_resp = run(api_user_me(req))
        assert me_resp.status_code == 200
        me_data = json.loads(me_resp.body)
        assert "username" in me_data
        assert me_data["username"]

    def test_search_users_returns_username(self):
        """GET /api/users/search returns username field in results."""
        import json
        from api.app import api_search_users
        # Register a searcher and a target
        searcher_resp, searcher_email = _register_user(name="Searcher")
        searcher_id = json.loads(searcher_resp.body)["user_id"]
        target_resp, target_email = _register_user(name="SearchTarget")
        target_data = json.loads(target_resp.body)

        req = _make_request({"app_user_id": searcher_id})
        resp = run(api_search_users(req, q=target_data["username"]))
        assert resp.status_code == 200
        users = json.loads(resp.body)["users"]
        found = next((u for u in users if u["user_id"] == target_data["user_id"]), None)
        assert found is not None
        assert "username" in found

    def test_search_users_matches_username(self):
        """User search matches against the username field."""
        import json
        from api.app import api_search_users
        searcher_resp, _ = _register_user(name="UsernameSearcher")
        searcher_id = json.loads(searcher_resp.body)["user_id"]
        target_resp, target_email = _register_user(name="TargetByName")
        target_data = json.loads(target_resp.body)
        target_username = target_data["username"]

        req = _make_request({"app_user_id": searcher_id})
        # Search by full username
        resp = run(api_search_users(req, q=target_username))
        assert resp.status_code == 200
        users = json.loads(resp.body)["users"]
        assert any(u["user_id"] == target_data["user_id"] for u in users)

    def test_search_requires_login(self):
        """GET /api/users/search without login → 401."""
        from api.app import api_search_users
        req = _make_request({})
        resp = run(api_search_users(req, q="someone"))
        assert resp.status_code == 401

    def test_search_empty_query_returns_empty(self):
        """GET /api/users/search with empty q returns empty list."""
        import json
        from api.app import api_search_users
        resp, email = _register_user(name="SearchEmpty")
        user_id = json.loads(resp.body)["user_id"]
        req = _make_request({"app_user_id": user_id})
        resp = run(api_search_users(req, q=""))
        assert resp.status_code == 200
        assert json.loads(resp.body)["users"] == []

    def test_dm_conversation_other_user_has_username(self):
        """DM conversation list includes username in other_user."""
        import json
        from api.app import api_dm_list_conversations, api_dm_start_conversation, _DMStartRequest
        resp_a, email_a = _register_user(name="DM_UsernameA")
        resp_b, email_b = _register_user(name="DM_UsernameB")
        uid_a = json.loads(resp_a.body)["user_id"]
        uid_b = json.loads(resp_b.body)["user_id"]

        req_a = _make_request({"app_user_id": uid_a})
        run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b)))

        list_resp = run(api_dm_list_conversations(req_a))
        convs = json.loads(list_resp.body)["conversations"]
        assert len(convs) > 0
        conv = convs[0]
        assert "username" in conv["other_user"]
        assert conv["other_user"]["username"]

    def test_dm_last_message_has_sender_username(self):
        """DM conversation last_message includes sender_username after a message is sent."""
        import json
        from api.app import (
            api_dm_list_conversations, api_dm_start_conversation,
            api_dm_send, _DMStartRequest, _DMSendRequest,
        )
        resp_a, email_a = _register_user(name="DM_SenderUsernameA")
        resp_b, email_b = _register_user(name="DM_SenderUsernameB")
        uid_a = json.loads(resp_a.body)["user_id"]
        uid_b = json.loads(resp_b.body)["user_id"]

        req_a = _make_request({"app_user_id": uid_a})
        conv_data = json.loads(run(api_dm_start_conversation(req_a, _DMStartRequest(other_user_id=uid_b))).body)
        conv_id = conv_data["conv"]["conv_id"]

        run(api_dm_send(req_a, _DMSendRequest(conv_id=conv_id, content="Hello with username")))

        list_resp = run(api_dm_list_conversations(req_a))
        convs = json.loads(list_resp.body)["conversations"]
        found = next((c for c in convs if c["conv_id"] == conv_id), None)
        assert found is not None
        assert found["last_message"] is not None
        assert "sender_username" in found["last_message"]
        assert found["last_message"]["sender_username"]


# ===========================================================================
# Occupancy status on properties
# ===========================================================================

class TestRideVehicleFields:
    def test_post_ride_with_vehicle_fields(self):
        """Posting a ride with vehicle_color, vehicle_type, plate_number stores them."""
        import json
        resp_data, email = _register_driver("VehicleFieldsDriver")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_post(req, _RidePostRequest(
            origin="London Heathrow",
            destination="Central London",
            departure="2030-08-01T10:00",
            seats=4,
            vehicle_color="Silver",
            vehicle_type="Sedan",
            plate_number="AB12 CDE",
        )))
        body = json.loads(resp.body)
        assert resp.status_code == 201
        assert body["ok"] is True

    def test_rides_list_returns_vehicle_fields(self):
        """GET /api/rides/list returns vehicle_color, vehicle_type, plate_number."""
        import json
        resp_data, email = _register_driver("VehicleListDriver")
        user_id = json.loads(resp_data.body)["user_id"]
        session = _login_session(email)
        req = _make_request(session)
        run(api_ride_post(req, _RidePostRequest(
            origin="Manchester Airport",
            destination="Manchester City",
            departure="2030-09-01T08:00",
            seats=2,
            vehicle_color="Black",
            vehicle_type="SUV",
            plate_number="XY99 ZZZ",
        )))
        list_resp = run(api_rides_list())
        rides = json.loads(list_resp.body)["rides"]
        # Find the ride by driver matching user
        matching = [r for r in rides if r.get("vehicle_color") == "Black" or r.get("plate_number") == "XY99 ZZZ"]
        assert len(matching) >= 1
        ride = matching[0]
        assert ride["vehicle_color"] == "Black"
        assert ride["vehicle_type"] == "SUV"
        assert ride["plate_number"] == "XY99 ZZZ"


# ---------------------------------------------------------------------------
# Journey Confirmation
# ---------------------------------------------------------------------------

class TestJourneyConfirmation:
    def test_confirm_journey_ok(self):
        """Passenger can confirm journey for a ride."""
        import json
        from api.app import api_ride_confirm_journey, api_ride_confirmed_users, _JourneyConfirmRequest

        # Create driver + ride
        resp_data, d_email = _register_driver("JourneyDriver")
        d_uid = json.loads(resp_data.body)["user_id"]
        d_session = _login_session(d_email)
        d_req = _make_request(d_session)
        ride_resp = run(api_ride_post(d_req, _RidePostRequest(
            origin="Airport", destination="Hotel",
            departure="2030-10-01T12:00", seats=3,
        )))
        ride_id = json.loads(ride_resp.body)["ride_id"]

        # Create passenger + confirm
        p_resp, p_email = _register_user("JourneyPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        conf_resp = run(api_ride_confirm_journey(p_req, ride_id, _JourneyConfirmRequest(
            real_name="John Doe",
            contact="07700900000",
        )))
        body = json.loads(conf_resp.body)
        assert conf_resp.status_code == 200
        assert body["ok"] is True

    def test_confirm_journey_requires_login(self):
        """Unauthenticated user gets 401."""
        import json
        from api.app import api_ride_confirm_journey, _JourneyConfirmRequest
        req = _make_request({})
        resp = run(api_ride_confirm_journey(req, "fake-ride-id", _JourneyConfirmRequest(
            real_name="Test", contact="test@test.com"
        )))
        assert resp.status_code == 401

    def test_confirm_journey_missing_fields(self):
        """Empty real_name or contact returns 400."""
        import json
        from api.app import api_ride_confirm_journey, _JourneyConfirmRequest
        _, email = _register_user("MissingFieldsPassenger")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_confirm_journey(req, "any-ride-id", _JourneyConfirmRequest(
            real_name="", contact=""
        )))
        assert resp.status_code == 400

    def test_get_confirmed_users_by_driver(self):
        """Driver can fetch the list of confirmed passengers for their ride."""
        import json
        from api.app import api_ride_confirm_journey, api_ride_confirmed_users, _JourneyConfirmRequest

        resp_data, d_email = _register_driver("ConfirmedListDriver")
        d_uid = json.loads(resp_data.body)["user_id"]
        d_session = _login_session(d_email)
        d_req = _make_request(d_session)
        ride_resp = run(api_ride_post(d_req, _RidePostRequest(
            origin="Station", destination="Hotel",
            departure="2030-11-01T09:00", seats=4,
        )))
        ride_id = json.loads(ride_resp.body)["ride_id"]

        # Passenger confirms
        p_resp, p_email = _register_user("ConfirmedPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        run(api_ride_confirm_journey(p_req, ride_id, _JourneyConfirmRequest(
            real_name="Jane Smith", contact="jane@example.com"
        )))

        # Driver lists confirmed users
        users_resp = run(api_ride_confirmed_users(d_req, ride_id))
        body = json.loads(users_resp.body)
        assert "confirmed_users" in body
        assert len(body["confirmed_users"]) == 1
        assert body["confirmed_users"][0]["real_name"] == "Jane Smith"
        assert body["confirmed_users"][0]["contact"] == "jane@example.com"

    def test_confirmed_users_unauthorized_for_non_driver(self):
        """Non-owner passenger cannot view confirmed users list."""
        import json
        from api.app import api_ride_confirm_journey, api_ride_confirmed_users, _JourneyConfirmRequest

        resp_data, d_email = _register_driver("AuthConfirmedDriver")
        d_session = _login_session(d_email)
        d_req = _make_request(d_session)
        ride_resp = run(api_ride_post(d_req, _RidePostRequest(
            origin="Airport", destination="City",
            departure="2030-12-01T09:00", seats=2,
        )))
        ride_id = json.loads(ride_resp.body)["ride_id"]

        # Another passenger tries to view confirmed users
        p_resp, p_email = _register_user("UnauthorizedPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        resp = run(api_ride_confirmed_users(p_req, ride_id))
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Proximity Notification
# ---------------------------------------------------------------------------

class TestProximityNotify:
    def test_proximity_notify_requires_driver(self):
        """Non-driver user gets 403."""
        import json
        from api.app import api_ride_proximity_notify, _ProximityNotifyRequest
        _, email = _register_user("NotADriver")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_ride_proximity_notify(req, "fake-ride-id", _ProximityNotifyRequest(distance_km=2.0)))
        assert resp.status_code == 403

    def test_proximity_notify_ok(self):
        """Driver can send proximity notification; returns notified count."""
        import json
        from api.app import api_ride_confirm_journey, api_ride_proximity_notify, _JourneyConfirmRequest, _ProximityNotifyRequest

        resp_data, d_email = _register_driver("ProximityDriver")
        d_session = _login_session(d_email)
        d_req = _make_request(d_session)
        ride_resp = run(api_ride_post(d_req, _RidePostRequest(
            origin="Depot", destination="Airport",
            departure="2031-01-01T06:00", seats=2,
        )))
        ride_id = json.loads(ride_resp.body)["ride_id"]

        # Passenger confirms
        p_resp, p_email = _register_user("ProximityPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        run(api_ride_confirm_journey(p_req, ride_id, _JourneyConfirmRequest(
            real_name="Near Passenger", contact="near@example.com"
        )))

        # Driver sends proximity alert
        notify_resp = run(api_ride_proximity_notify(d_req, ride_id, _ProximityNotifyRequest(distance_km=3.5)))
        body = json.loads(notify_resp.body)
        assert notify_resp.status_code == 200
        assert body["ok"] is True
        assert body["notified"] == 1
        assert "3.5 km" in body["message"]

    def test_proximity_notify_miles_unit(self):
        """Proximity notify with miles unit uses miles in message."""
        import json
        from api.app import api_ride_proximity_notify, _ProximityNotifyRequest

        resp_data, d_email = _register_driver("MilesDriver")
        d_session = _login_session(d_email)
        d_req = _make_request(d_session)
        ride_resp = run(api_ride_post(d_req, _RidePostRequest(
            origin="Depot B", destination="Airport B",
            departure="2031-02-01T06:00", seats=2,
        )))
        ride_id = json.loads(ride_resp.body)["ride_id"]

        notify_resp = run(api_ride_proximity_notify(d_req, ride_id, _ProximityNotifyRequest(
            distance_km=5.0, distance_miles=3.1, unit="miles"
        )))
        body = json.loads(notify_resp.body)
        assert body["ok"] is True
        assert "miles" in body["message"]


# ---------------------------------------------------------------------------
# Ride Requests (Supply & Demand)
# ---------------------------------------------------------------------------

class TestRideRequests:
    def test_create_ride_request_ok(self):
        """Passenger can create a ride request."""
        import json
        from api.app import api_create_ride_request, api_list_ride_requests, _RideRequestCreate

        p_resp, p_email = _register_user("RequestPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)

        resp = run(api_create_ride_request(p_req, _RideRequestCreate(
            origin="Manchester Airport",
            destination="City Centre",
            desired_date="2031-03-10T10:00",
            passengers=2,
            price_min=10.0,
            price_max=30.0,
        )))
        body = json.loads(resp.body)
        assert resp.status_code == 201
        assert body["ok"] is True
        assert "request_id" in body

    def test_list_ride_requests_shows_open(self):
        """GET /api/ride_requests returns open requests."""
        import json
        from api.app import api_create_ride_request, api_list_ride_requests, _RideRequestCreate

        p_resp, p_email = _register_user("ListRequestPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        run(api_create_ride_request(p_req, _RideRequestCreate(
            origin="Leeds", destination="Sheffield",
            desired_date="2031-04-01T09:00", passengers=1,
        )))
        list_resp = run(api_list_ride_requests())
        requests = json.loads(list_resp.body)["requests"]
        assert len(requests) >= 1

    def test_create_ride_request_requires_login(self):
        """Unauthenticated user gets 401."""
        import json
        from api.app import api_create_ride_request, _RideRequestCreate
        req = _make_request({})
        resp = run(api_create_ride_request(req, _RideRequestCreate(
            origin="A", destination="B",
            desired_date="2031-01-01T00:00", passengers=1,
        )))
        assert resp.status_code == 401

    def test_driver_accepts_ride_request(self):
        """Driver can accept an open ride request."""
        import json
        from api.app import api_create_ride_request, api_accept_ride_request, _RideRequestCreate

        p_resp, p_email = _register_user("AcceptRequestPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        create_resp = run(api_create_ride_request(p_req, _RideRequestCreate(
            origin="Bristol", destination="Bath",
            desired_date="2031-05-01T11:00", passengers=1,
        )))
        request_id = json.loads(create_resp.body)["request_id"]

        d_resp, d_email = _register_driver("AcceptRequestDriver")
        d_session = _login_session(d_email)
        d_req = _make_request(d_session)
        accept_resp = run(api_accept_ride_request(d_req, request_id))
        body = json.loads(accept_resp.body)
        assert accept_resp.status_code == 200
        assert body["ok"] is True
        assert "conv_id" in body

    def test_non_driver_cannot_accept_request(self):
        """Passenger cannot accept a ride request."""
        import json
        from api.app import api_create_ride_request, api_accept_ride_request, _RideRequestCreate

        p_resp, p_email = _register_user("CannotAcceptPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        create_resp = run(api_create_ride_request(p_req, _RideRequestCreate(
            origin="Oxford", destination="Cambridge",
            desired_date="2031-06-01T10:00", passengers=1,
        )))
        request_id = json.loads(create_resp.body)["request_id"]

        p2_resp, p2_email = _register_user("CannotAcceptPassenger2")
        p2_session = _login_session(p2_email)
        p2_req = _make_request(p2_session)
        resp = run(api_accept_ride_request(p2_req, request_id))
        assert resp.status_code == 403

    def test_cancel_ride_request(self):
        """Passenger can cancel their own open request."""
        import json
        from api.app import api_create_ride_request, api_cancel_ride_request, _RideRequestCreate

        p_resp, p_email = _register_user("CancelRequestPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        create_resp = run(api_create_ride_request(p_req, _RideRequestCreate(
            origin="Brighton", destination="London",
            desired_date="2031-07-01T08:00", passengers=1,
        )))
        request_id = json.loads(create_resp.body)["request_id"]

        cancel_resp = run(api_cancel_ride_request(p_req, request_id))
        assert json.loads(cancel_resp.body)["ok"] is True

    def test_cannot_accept_already_accepted(self):
        """Accepting an already-accepted request returns 409."""
        import json
        from api.app import api_create_ride_request, api_accept_ride_request, _RideRequestCreate

        p_resp, p_email = _register_user("DoubleAcceptPassenger")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        create_resp = run(api_create_ride_request(p_req, _RideRequestCreate(
            origin="York", destination="Leeds",
            desired_date="2031-08-01T07:00", passengers=1,
        )))
        request_id = json.loads(create_resp.body)["request_id"]

        d_resp, d_email = _register_driver("DoubleAcceptDriver1")
        d_session = _login_session(d_email)
        d_req = _make_request(d_session)
        run(api_accept_ride_request(d_req, request_id))

        # Second driver tries to accept
        d2_resp, d2_email = _register_driver("DoubleAcceptDriver2")
        d2_session = _login_session(d2_email)
        d2_req = _make_request(d2_session)
        resp2 = run(api_accept_ride_request(d2_req, request_id))
        assert resp2.status_code == 409


# ---------------------------------------------------------------------------
# Travel Companions
# ---------------------------------------------------------------------------

class TestTravelCompanions:
    def test_create_companion_ok(self):
        """User can post a travel companion listing."""
        import json
        from api.app import api_create_travel_companion, api_list_travel_companions, _TravelCompanionCreate

        p_resp, p_email = _register_user("CompanionPoster")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)

        resp = run(api_create_travel_companion(p_req, _TravelCompanionCreate(
            origin_country="United Kingdom",
            destination_country="France",
            origin_city="London",
            destination_city="Paris",
            travel_date="2031-09-15",
            notes="Looking for company",
        )))
        body = json.loads(resp.body)
        assert resp.status_code == 201
        assert body["ok"] is True
        assert "companion_id" in body

    def test_list_companions_returns_active(self):
        """GET /api/travel_companions returns active listings."""
        import json
        from api.app import api_create_travel_companion, api_list_travel_companions, _TravelCompanionCreate

        p_resp, p_email = _register_user("CompanionLister")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        run(api_create_travel_companion(p_req, _TravelCompanionCreate(
            origin_country="Germany",
            destination_country="Spain",
            travel_date="2031-10-01",
        )))
        resp = run(api_list_travel_companions())
        companions = json.loads(resp.body)["companions"]
        assert len(companions) >= 1

    def test_list_companions_filter_by_country(self):
        """GET /api/travel_companions?origin_country=Italy filters results."""
        import json
        from api.app import api_create_travel_companion, api_list_travel_companions, _TravelCompanionCreate

        p_resp, p_email = _register_user("FilterCompanion")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)
        run(api_create_travel_companion(p_req, _TravelCompanionCreate(
            origin_country="Italy",
            destination_country="Greece",
            travel_date="2031-11-01",
        )))
        resp = run(api_list_travel_companions(origin_country="Italy"))
        companions = json.loads(resp.body)["companions"]
        assert all("italy" in c["origin_country"].lower() for c in companions)

    def test_create_companion_requires_login(self):
        """Unauthenticated user gets 401."""
        import json
        from api.app import api_create_travel_companion, _TravelCompanionCreate
        req = _make_request({})
        resp = run(api_create_travel_companion(req, _TravelCompanionCreate(
            origin_country="UK", destination_country="US",
            travel_date="2032-01-01",
        )))
        assert resp.status_code == 401

    def test_delete_companion_ok(self):
        """User can remove their own companion listing (marks inactive)."""
        import json
        from api.app import api_create_travel_companion, api_delete_travel_companion, api_list_travel_companions, _TravelCompanionCreate

        p_resp, p_email = _register_user("CompanionDeleter")
        p_session = _login_session(p_email)
        p_req = _make_request(p_session)

        create_resp = run(api_create_travel_companion(p_req, _TravelCompanionCreate(
            origin_country="Norway",
            destination_country="Sweden",
            travel_date="2032-02-01",
        )))
        companion_id = json.loads(create_resp.body)["companion_id"]

        del_resp = run(api_delete_travel_companion(p_req, companion_id))
        assert json.loads(del_resp.body)["ok"] is True

        # Should not appear in active list
        list_resp = run(api_list_travel_companions(origin_country="Norway"))
        companions = json.loads(list_resp.body)["companions"]
        assert not any(c["companion_id"] == companion_id for c in companions)

    def test_cannot_delete_others_companion(self):
        """User cannot delete another user's companion listing."""
        import json
        from api.app import api_create_travel_companion, api_delete_travel_companion, _TravelCompanionCreate

        owner_resp, owner_email = _register_user("CompanionOwner")
        owner_session = _login_session(owner_email)
        owner_req = _make_request(owner_session)
        create_resp = run(api_create_travel_companion(owner_req, _TravelCompanionCreate(
            origin_country="Denmark",
            destination_country="Netherlands",
            travel_date="2032-03-01",
        )))
        companion_id = json.loads(create_resp.body)["companion_id"]

        other_resp, other_email = _register_user("CompanionThief")
        other_session = _login_session(other_email)
        other_req = _make_request(other_session)
        resp = run(api_delete_travel_companion(other_req, companion_id))
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Feature 1.1 – Registration: phone field
# ---------------------------------------------------------------------------

class TestUserRegisterPhone:
    def test_register_with_phone(self):
        import json
        email = _unique_email("phonereg")
        resp = run(api_user_register(_UserRegisterRequest(
            name="PhoneUser",
            email=email,
            password="Secure1!",
            role="passenger",
            phone="+44 7911 123456",
        )))
        assert resp.status_code == 201
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert body["phone"] == "+44 7911 123456"

    def test_register_without_phone_defaults_empty(self):
        import json
        email = _unique_email("nophone")
        resp = run(api_user_register(_UserRegisterRequest(
            name="NoPhone",
            email=email,
            password="Secure1!",
        )))
        assert resp.status_code == 201
        body = json.loads(resp.body)
        assert body.get("phone", "") == ""

    def test_register_returns_email_verified_flag(self):
        import json
        email = _unique_email("verifyflag")
        resp = run(api_user_register(_UserRegisterRequest(
            name="VerifyFlag",
            email=email,
            password="Secure1!",
        )))
        assert resp.status_code == 201
        body = json.loads(resp.body)
        # email_verified should be present in the response
        assert "email_verified" in body


# ---------------------------------------------------------------------------
# Feature 1.3 – Password Reset
# ---------------------------------------------------------------------------

class TestForgotPassword:
    def test_forgot_password_unknown_email_still_ok(self):
        """Should not reveal whether the email is registered."""
        import json
        from api.app import api_forgot_password, _ForgotPasswordRequest
        resp = run(api_forgot_password(_ForgotPasswordRequest(email="nobody@nowhere.test")))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert body["ok"] is True

    def test_forgot_password_invalid_email_returns_400(self):
        from api.app import api_forgot_password, _ForgotPasswordRequest
        resp = run(api_forgot_password(_ForgotPasswordRequest(email="not-an-email")))
        assert resp.status_code == 400

    def test_forgot_password_known_email_returns_token(self):
        """For demo purposes the token is included in the response."""
        import json
        from api.app import api_forgot_password, _ForgotPasswordRequest
        _, email = _register_user("ForgotPwUser")
        resp = run(api_forgot_password(_ForgotPasswordRequest(email=email)))
        body = json.loads(resp.body)
        assert body["ok"] is True
        assert "token" in body
        assert len(body["token"]) > 10


class TestResetPassword:
    def test_reset_password_ok(self):
        import json
        from api.app import api_forgot_password, api_reset_password, _ForgotPasswordRequest, _ResetPasswordRequest
        _, email = _register_user("ResetPwUser")
        # Get reset token
        forgot_resp = run(api_forgot_password(_ForgotPasswordRequest(email=email)))
        token = json.loads(forgot_resp.body)["token"]
        # Reset the password
        resp = run(api_reset_password(_ResetPasswordRequest(token=token, new_password="NewPass1!")))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert body["ok"] is True

    def test_reset_password_allows_login_with_new_password(self):
        import json
        from api.app import api_forgot_password, api_reset_password, _ForgotPasswordRequest, _ResetPasswordRequest
        _, email = _register_user("ResetLoginUser")
        forgot_resp = run(api_forgot_password(_ForgotPasswordRequest(email=email)))
        token = json.loads(forgot_resp.body)["token"]
        run(api_reset_password(_ResetPasswordRequest(token=token, new_password="BrandNew1!")))
        # Should be able to log in with the new password
        session = {}
        req = _make_request(session)
        resp = run(api_user_login(req, _UserLoginRequest(email=email, password="BrandNew1!")))
        body = json.loads(resp.body)
        assert body["ok"] is True

    def test_reset_password_invalid_token_returns_400(self):
        from api.app import api_reset_password, _ResetPasswordRequest
        resp = run(api_reset_password(_ResetPasswordRequest(token="notarealtoken", new_password="NewPass1!")))
        assert resp.status_code == 400

    def test_reset_password_token_single_use(self):
        """Using the same token twice should fail on the second attempt."""
        import json
        from api.app import api_forgot_password, api_reset_password, _ForgotPasswordRequest, _ResetPasswordRequest
        _, email = _register_user("SingleUseToken")
        forgot_resp = run(api_forgot_password(_ForgotPasswordRequest(email=email)))
        token = json.loads(forgot_resp.body)["token"]
        run(api_reset_password(_ResetPasswordRequest(token=token, new_password="First1!")))
        resp2 = run(api_reset_password(_ResetPasswordRequest(token=token, new_password="Second1!")))
        assert resp2.status_code == 400

    def test_reset_password_short_password_returns_400(self):
        import json
        from api.app import api_forgot_password, api_reset_password, _ForgotPasswordRequest, _ResetPasswordRequest
        _, email = _register_user("ShortResetPw")
        forgot_resp = run(api_forgot_password(_ForgotPasswordRequest(email=email)))
        token = json.loads(forgot_resp.body)["token"]
        resp = run(api_reset_password(_ResetPasswordRequest(token=token, new_password="abc")))
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Feature 1.5 – Driver Dashboard API
# ---------------------------------------------------------------------------

class TestDriverDashboard:
    def test_driver_dashboard_requires_login(self):
        from api.app import api_driver_dashboard
        req = _make_request({})
        resp = run(api_driver_dashboard(req))
        assert resp.status_code == 401

    def test_driver_dashboard_returns_data_for_driver(self):
        import json
        from api.app import api_driver_dashboard
        _, email = _register_driver("DashDriver")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_driver_dashboard(req))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert "user" in body
        assert "stats" in body
        assert "posted_rides" in body

    def test_driver_dashboard_forbidden_for_passenger(self):
        from api.app import api_driver_dashboard
        _, email = _register_user("PassengerDash")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_driver_dashboard(req))
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Feature 2.3 – GET /api/rides/{ride_id}
# ---------------------------------------------------------------------------

class TestGetRideById:
    def test_get_ride_returns_ride(self):
        import json
        from api.app import api_get_ride, api_ride_post, _RidePostRequest
        _, driver_email = _register_driver("GetRideDriver")
        session = _login_session(driver_email)
        req = _make_request(session)
        post_resp = run(api_ride_post(req, _RidePostRequest(
            origin="City A", destination="Airport", departure="2035-01-01 08:00",
            seats=3, fare=25.0,
        )))
        ride_id = json.loads(post_resp.body)["ride_id"]
        # Fetch single ride
        resp = run(api_get_ride(req, ride_id))
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert body["ride"]["ride_id"] == ride_id
        assert body["ride"]["origin"] == "City A"

    def test_get_ride_not_found_returns_404(self):
        from api.app import api_get_ride
        _, email = _register_user("GetRideNotFound")
        session = _login_session(email)
        req = _make_request(session)
        resp = run(api_get_ride(req, "nonexistent-ride-id"))
        assert resp.status_code == 404

    def test_get_ride_requires_login(self):
        from api.app import api_get_ride
        req = _make_request({})
        resp = run(api_get_ride(req, "some-ride-id"))
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Feature 1.1 – Email verification token flow
# ---------------------------------------------------------------------------

class TestEmailVerification:
    def test_verify_email_invalid_token_returns_400(self):
        from api.app import api_verify_email
        req = _make_request({})
        resp = run(api_verify_email(req, token="badtoken"))
        assert resp.status_code == 400

    def test_verify_email_missing_token_returns_400(self):
        from api.app import api_verify_email
        req = _make_request({})
        resp = run(api_verify_email(req, token=""))
        assert resp.status_code == 400

    def test_verify_email_valid_token_marks_user_verified(self):
        """Simulate the verification flow directly via the token store."""
        import json
        import time
        from api.app import (
            api_verify_email, _email_verify_tokens, _email_verify_lock,
            _get_app_user, _get_db, _db_lock, USE_POSTGRES,
        )
        # Register a user (they'll be auto-verified in test env without SMTP)
        _, email = _register_user("VerifyEmailUser")
        # Manually insert a verification token
        email_lower = email.lower()
        # Look up user_id
        from api.app import _get_app_user_by_email
        user = _get_app_user_by_email(email_lower)
        assert user is not None
        user_id = user["user_id"]

        # Force email_verified to 0
        with _db_lock:
            conn = _get_db()
            try:
                if USE_POSTGRES:
                    cur = conn.cursor()
                    cur.execute("UPDATE app_users SET email_verified=0 WHERE user_id=%s", (user_id,))
                else:
                    conn.execute("UPDATE app_users SET email_verified=0 WHERE user_id=?", (user_id,))
                conn.commit()
            finally:
                conn.close()

        import secrets
        token = secrets.token_urlsafe(32)
        with _email_verify_lock:
            _email_verify_tokens[token] = {
                "user_id": user_id,
                "email": email_lower,
                "expires_at": time.time() + 3600,
            }

        req = _make_request({})
        resp = run(api_verify_email(req, token=token))
        # Should redirect (303) or return success
        assert resp.status_code in (200, 303)

        # Verify the token is consumed (single-use)
        with _email_verify_lock:
            assert token not in _email_verify_tokens
