# yotweek — Travel Social Platform

<p align="center">
  <img src="https://github.com/user-attachments/assets/e5663d6c-8ee6-4439-a3db-d08c407dfadf" alt="yotweek logo" width="180"/>
</p>

<p align="center">
  yotweek is a free travel social platform — ride sharing, live driver maps, social feed, group trip planning, companion matching, SOS safety, and real-time messaging, all in one place.
</p>

---

## Overview

yotweek is a full travel social platform. Drivers post rides with auto-calculated fares; passengers find available drivers on a live map and book in seconds. Beyond ride sharing, users share travel posts on the social feed, plan group trips with collaborative checklists and cost splitting, match with compatible travel companions, and stay safe with a one-tap SOS system. All communication runs through a real-time end-to-end encrypted inbox.

---

## Core Features

- **🚗 Ride Share** — Drivers post airport or city rides; fares are calculated automatically from origin and destination coordinates. Passengers see animated ride cards, sort by fare or departure time, and book via real-time chat. Escrow-based booking with accept / complete / cancel lifecycle.
- **📍 Live Driver Map** — Interactive map showing active drivers within your radius, updated every 15 seconds. Click a driver card to see their details, vehicle, and distance from you.
- **💬 Real-Time Messaging Inbox** — Bi-directional direct messages and ride chat threads in a single unified view. End-to-end encrypted with image, audio, file, and location sharing. Message request gating and in-chat translation via LibreTranslate.
- **✅ Journey Confirmation** — Passengers confirm their journey directly inside the ride chat (name + contact), notifying drivers instantly. Drivers view all confirmed passengers and send proximity alerts.
- **📰 Social Feed** — Post travel updates (text, photo, video, check-in, question). Like, comment, share, and save posts. Trending feed surfaces the most-engaged content.
- **✈️ Group Trips** — Create and join group trips. Collaboratively add ideas, vote on destinations, manage a shared checklist, and calculate per-member cost splits automatically.
- **🤝 Travel Companions** — Smart companion matching based on travel style, budget tier, languages, interests, and travel date overlap. Mutual interest triggers an automatic introduction DM.
- **🆘 SOS Safety Button** — Fixed-position GPS-aware SOS button visible on every screen when logged in. Broadcasts an alert via Socket.IO, email, and to all trusted contacts simultaneously. Emergency resource directory pre-loaded for 10 countries.
- **🔔 Real-Time Notifications** — WebSocket-powered notifications for new messages, ride updates, driver arrival alerts, companion matches, and group trip activity, delivered without page reloads.
- **📱 Mobile-First Layout** — Responsive design that stacks gracefully on phones and tablets. Available as a Flutter app for iOS and Android.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Python + FastAPI + Socket.IO |
| Database | PostgreSQL (production) / SQLite (development) |
| Real-time | WebSocket via Socket.IO |
| Maps | Leaflet + OpenStreetMap |
| Mobile | Flutter (iOS & Android) |

---

## Flutter Directory

```
flutter_app/lib/
├── features/
│   └── ride_sharing/
│       ├── airport_pickup/
│       │   ├── booking_screen.dart        # Client booking flow (airport → destination)
│       │   ├── fare_calculator.dart       # Distance-based fare engine (Haversine)
│       │   └── auto_response_service.dart # Structured prompt auto-reply
│       ├── driver_tracking/
│       │   ├── driver_registration.dart   # Registration form + document upload
│       │   ├── verification_badge.dart    # Badge widget for verified drivers
│       │   └── realtime_location.dart     # WebSocket location broadcasting
│       └── map/
│           ├── scrollable_map.dart        # Interactive, scrollable map widget
│           ├── driver_icons.dart          # Animated driver markers with badge overlay
│           └── sticky_layout.dart         # 3-column sticky layout shell
└── shared/
    ├── widgets/                           # Reusable UI components
    ├── services/                          # Shared API/socket service layer
    └── models/                            # Shared data models
```

---

## Getting Started

### Prerequisites

| Requirement | Version |
|-------------|---------|
| Python | 3.11+ |
| Flutter | >= 3.19.0 |

### Server Setup

```bash
# 1. Clone the repository
git clone https://github.com/AllanRye9/yotweek.git
cd yotweek

# 2. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment variables (copy and edit as needed)
#    FARE_PER_KM=1.0          — base fare rate per km
#    DATABASE_URL=<postgres>   — PostgreSQL connection string (omit for SQLite)
#    SECRET_KEY=<secret>       — session secret (set in production)
#    SMTP_HOST / SMTP_PORT     — email sending (optional)
#    NOMINATIM_URL             — custom Nominatim geocoder (optional)

# 5. Start the server
python api/app.py
# -> http://127.0.0.1:5000
```

### Flutter Mobile App

```bash
cd flutter_app
flutter pub get
flutter run
# Configure the backend URL via Settings in the app
```

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register (name, email, password; optional `date_of_birth` for 18+ gate) |
| `POST` | `/api/auth/login` | Log in |
| `POST` | `/api/auth/logout` | Log out |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/auth/magic_link` | Request a magic-link login email |
| `POST` | `/api/auth/forgot_password` | Send password-reset email |
| `POST` | `/api/auth/reset_password` | Reset password with token |
| `PUT` | `/api/auth/profile` | Update name / username / bio / location |
| `PUT` | `/api/auth/profile/details` | Update extended profile details |
| `POST` | `/api/auth/profile/avatar` | Upload avatar image |
| `DELETE` | `/api/auth/profile/avatar` | Remove avatar |
| `PUT` | `/api/auth/change_password` | Change password |
| `POST` | `/api/auth/driver_apply` | Submit driver application |
| `GET` | `/api/auth/driver_application` | Get own driver application status |

### Profile & Privacy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/profile/extra` | Get travel preferences (style, budget, interests, languages, travel dates) |
| `PUT` | `/api/profile/extra` | Update travel preferences |
| `PUT` | `/api/profile/privacy` | Set per-field privacy levels |
| `GET` | `/api/users/{id}/profile` | Public profile (name, username, avatar) |
| `GET` | `/api/users/{id}/full_profile` | Full profile with travel preferences (respects privacy settings) |

### Ride Share

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rides/calculate_fare` | Auto-calculate fare (`?origin_lat=&origin_lng=&dest_lat=&dest_lng=`) |
| `GET` | `/api/rides/estimate_fare` | Geocode-based fare estimate (`?start=&destination=&seats=`) |
| `POST` | `/api/rides/post` | Post a ride (driver only; fare auto-calculated from coordinates) |
| `GET` | `/api/rides/list` | List all rides (includes `fare`, `per_seat_cost`, `ride_type`) |
| `GET` | `/api/rides/scan` | Haversine radius scan for nearby rides (`?lat=&lng=&radius_km=`) |
| `GET` | `/api/rides/qr/{qr_token}` | Fetch ride details via QR token |
| `POST` | `/api/rides/{id}/confirm_journey` | Passenger confirms journey (name + contact) |
| `GET` | `/api/rides/{id}/confirmed_users` | Driver: list confirmed passengers |
| `POST` | `/api/rides/{id}/proximity_notify` | Driver: send proximity alert to passengers |
| `POST` | `/api/rides/{id}/book` | Book a seat (escrow hold) |
| `POST` | `/api/rides/{id}/bookings/{bid}/accept` | Driver accepts booking |
| `POST` | `/api/rides/{id}/bookings/{bid}/complete` | Mark booking complete (release escrow) |
| `POST` | `/api/rides/{id}/bookings/{bid}/cancel` | Cancel booking (refund escrow) |
| `GET` | `/api/rides/{id}/bookings` | List bookings for a ride |
| `POST` | `/api/rides/{id}/wellness_ping` | Send wellness ping to passenger |
| `POST` | `/api/wellness_pings/{ping_id}/respond` | Passenger responds to wellness ping |
| `GET` | `/api/rides/{id}/audit_log` | Full ride audit log |
| `POST` | `/api/driver/location` | Broadcast driver location (verified drivers only) |
| `GET` | `/api/driver/locations` | All active verified driver locations |

### Social Feed

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/posts` | Create a post (text / photo / video / check-in / question) |
| `GET` | `/api/feed` | Paginated feed (supports `?type=&search=`) |
| `GET` | `/api/feed/trending` | Top trending posts by engagement |
| `GET` | `/api/posts/{id}` | Single post |
| `DELETE` | `/api/posts/{id}` | Delete own post |
| `POST` | `/api/posts/{id}/like` | Toggle like |
| `POST` | `/api/posts/{id}/save` | Toggle save |
| `POST` | `/api/posts/{id}/share` | Increment share count |
| `GET` | `/api/posts/{id}/comments` | List comments |
| `POST` | `/api/posts/{id}/comments` | Add comment |
| `DELETE` | `/api/posts/{id}/comments/{cid}` | Delete own comment |

### Group Trips

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/group_trips` | Create a group trip |
| `GET` | `/api/group_trips` | List group trips (public / own) |
| `GET` | `/api/group_trips/{id}` | Trip details + members |
| `POST` | `/api/group_trips/{id}/join` | Join a trip |
| `DELETE` | `/api/group_trips/{id}/leave` | Leave a trip |
| `POST` | `/api/group_trips/{id}/ideas` | Add a destination idea |
| `GET` | `/api/group_trips/{id}/ideas` | List ideas with vote counts |
| `POST` | `/api/group_trips/{id}/ideas/{iid}/vote` | Vote on an idea |
| `GET` | `/api/group_trips/{id}/cost_split` | Per-member cost split calculation |
| `POST` | `/api/group_trips/{id}/checklist` | Add a checklist item |
| `GET` | `/api/group_trips/{id}/checklist` | List checklist items |
| `PUT` | `/api/group_trips/{id}/checklist/{item_id}` | Update checklist item (check/uncheck) |

### Travel Companions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/companions/suggestions` | Smart companion matches (scored by shared interests, budget, dates) |
| `POST` | `/api/companions/{id}/interested` | Express interest (mutual match → auto intro DM) |
| `POST` | `/api/companions/{id}/pass` | Pass on a suggestion |

### Safety

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sos` | Trigger SOS alert (Socket.IO broadcast + email + trusted contacts) |
| `POST` | `/api/sos/{alert_id}/resolve` | Resolve an active SOS alert |
| `GET` | `/api/trusted_contacts` | List trusted contacts |
| `POST` | `/api/trusted_contacts` | Add a trusted contact |
| `DELETE` | `/api/trusted_contacts/{id}` | Remove a trusted contact |
| `GET` | `/api/emergency_resources` | Emergency numbers by country (10 countries pre-seeded) |

### Messaging & Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dm/conversations` | List DM conversations with last message preview (supports `?search=`) |
| `POST` | `/api/dm/conversations` | Start a new DM conversation |
| `GET` | `/api/dm/conversations/{id}/messages` | Fetch conversation history |
| `POST` | `/api/dm/send` | Send a direct message |
| `DELETE` | `/api/dm/messages/{msg_id}` | Delete own message |
| `PUT` | `/api/dm/conversations/{id}/e2e` | Toggle end-to-end encryption for a conversation |
| `POST` | `/api/dm/conversations/{id}/accept_request` | Accept a message request |
| `POST` | `/api/dm/conversations/{id}/decline_request` | Decline a message request |
| `GET` | `/api/translate` | Translate text via LibreTranslate proxy (`?text=&target=`) |
| `GET` | `/api/notifications` | Fetch notifications (with `unread` count) |
| `PUT` | `/api/notifications/read_all` | Mark all notifications read |
| `DELETE` | `/api/notifications/clear_all` | Clear all notifications |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/driver_applications` | List pending driver applications |
| `POST` | `/api/admin/driver_applications/{id}/approve` | Approve / reject driver application |
| `GET` | `/api/admin/users` | List all users |
| `DELETE` | `/api/admin/users/{id}` | Delete a user |
| `GET` | `/api/admin/rides` | List all rides |
| `DELETE` | `/api/admin/rides/{id}` | Delete a ride |
| `GET` | `/api/analytics/dashboard` | Platform analytics (DAU, totals, ride completion rate) |

### Socket.IO Events

| Direction | Event | Description |
|-----------|-------|-------------|
| Server to Client | `new_ride` | New ride posted (real-time) |
| Server to Client | `ride_chat_message` | New chat message in a ride room |
| Server to Client | `driver_nearby` | Driver location broadcast |
| Server to Client | `driver_arrived` | Driver arrival alert to passengers |
| Server to Client | `dm_message` | New direct message received |
| Server to Client | `dm_typing` | Other user is typing |
| Server to Client | `dm_read` | Message read receipt |
| Server to Client | `sos_alert` | SOS alert broadcast to all connected users |
| Server to Client | `notification` | Generic real-time notification |
| Client to Server | `identify` | Associate socket with `user_id` |
| Client to Server | `dm_join` | Join a DM conversation room |
| Client to Server | `dm_message` | Send a DM |
| Client to Server | `join_ride_chat` | Join a ride's chat room |
| Client to Server | `ride_chat_message` | Send a ride chat message |

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | random | FastAPI session secret — set in production |
| `ALLOWED_ORIGINS` | `*` | CORS origins — restrict in production |
| `PORT` | `5000` | Server port |
| `FARE_PER_KM` | `1.0` | Base fare rate (USD) per kilometre |
| `DATABASE_URL` | *(SQLite)* | PostgreSQL connection string |
| `SMTP_HOST` | — | SMTP server for email notifications |
| `SMTP_PORT` | `587` | SMTP port |
| `NOMINATIM_URL` | public OSM | Custom Nominatim geocoder URL |
| `LIBRETRANSLATE_URL` | — | LibreTranslate instance URL for in-chat translation |
| `AI_API_KEY` | — | API key for the AI assistant endpoint |

---

## Docker

```bash
docker build -t yotweek .
docker run -p 5000:5000 yotweek
```

---

## Platform Sections

| Section | Route | Description |
|---------|-------|-------------|
| Home | `/` | Overview and quick access to rides and map |
| Ride Share | `/rides` | Post rides (drivers) and find available rides (passengers) |
| Live Map | `/map` | Live driver map with radius search and driver cards |
| Social Feed | `/feed` | Travel posts — create, like, comment, save, share |
| Group Trips | `/group-trips` | Plan group trips with ideas, voting, checklist, and cost split |
| Inbox | `/inbox` | Direct messages and ride chat threads with real-time encrypted messaging |
| Notifications | `/notifications` | All real-time notifications in one view |
| Dashboard | `/user/dashboard` or `/driver/dashboard` | Personal hub: rides, history, inbox |
| Profile | `/profile` | Account settings, avatar, travel preferences, trusted contacts |
| AI Assistant | `/ai` | Companion AI for travel advice and trip planning |
| About | `/about` | About yotweek |
| FAQ | `/faq` | Frequently asked questions |
| Terms | `/terms` | Terms of service |
| Privacy | `/privacy` | Privacy policy |

---

## License

This project is provided as-is for personal and educational use.
