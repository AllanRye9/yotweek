# yotweek — All-in-One Free Platform

<p align="center">
  <img src="https://github.com/user-attachments/assets/e5663d6c-8ee6-4439-a3db-d08c407dfadf" alt="yotweek logo" width="180"/>
</p>

<p align="center">
  yotweek is your all-in-one free platform for ride sharing, tourist site discovery, video downloads, CV building, and document conversion — all in one place, no subscription required.
</p>

---

## Overview

yotweek combines everyday productivity tools with local travel discovery. Drivers post rides with auto-calculated fares; passengers find and book in seconds. Explore tourist attractions near your location on the Tourist Sites page — filtered by category and powered by live OpenStreetMap data. Download videos from 1,000+ sites, build a professional CV with ATS scoring, or convert documents between formats — everything is free and requires only a free account.

---

## Core Features

- **🚗 Ride Share** — Drivers post airport or city rides; fares are calculated automatically from origin and destination coordinates. Passengers see animated ride cards, sort by fare or departure time, and book via real-time chat. Verified drivers can broadcast their empty-car location to nearby passengers.
- **🗺️ Tourist Sites** — Location-aware discovery of tourist attractions, museums, parks, and historic landmarks near the user. Fetches live data from OpenStreetMap's Overpass API, displayed in a clean card grid with category filters.
- **💬 Animated Inbox** — A persistent animated inbox button at the top of every page shows unread message counts. Clicking it reveals direct messages, ride chat threads, and real estate conversations in a single unified view.
- **⬇ Video Downloader** — Download audio and video from YouTube, Instagram, TikTok, and 1,000+ other sites via yt-dlp. Supports playlists, audio-only extraction, and format selection.
- **📄 CV Builder** — Generate a professional PDF CV with built-in ATS (Applicant Tracking System) scoring and keyword analysis.
- **🔄 Document Converter** — Convert between PDF, Word, Excel, PowerPoint, and image formats.
- **🔔 Real-Time Notifications** — WebSocket-powered notifications for new messages, ride updates, and driver arrival alerts, delivered as animated toasts without page reloads.
- **📱 Mobile-First Layout** — Responsive design that stacks gracefully on phones and tablets. Available as a Flutter app for iOS and Android.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS |
| Backend | Python + FastAPI + Socket.IO |
| Database | PostgreSQL (production) / SQLite (development) |
| Real-time | WebSocket via Socket.IO |
| Maps | Leaflet + OpenStreetMap / Overpass API |
| Mobile | Flutter (iOS & Android) |
| Downloader | yt-dlp + ffmpeg |

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
| Flutter | ≥ 3.19.0 |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | latest |
| ffmpeg *(optional)* | for video merging |

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
# → http://127.0.0.1:5000
```

### Flutter Mobile App

```bash
cd flutter_app
flutter pub get
flutter run
# Configure the backend URL via Settings (⚙) in the app
```

---

## API Reference

### Downloader

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serves the main UI |
| `POST` | `/start_download` | Start a download; returns `{"download_id": "..."}` |
| `GET` | `/status/<id>` | Progress for a specific download |
| `GET` | `/files` | List all downloaded files |
| `GET` | `/downloads/<filename>` | Stream a file to the browser |
| `DELETE` | `/delete/<filename>` | Delete a downloaded file |
| `POST` | `/cancel/<id>` | Cancel an in-progress download |
| `GET` | `/health` | Health check |

### Ride Share

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rides/calculate_fare` | Auto-calculate fare (`?origin_lat=&origin_lng=&dest_lat=&dest_lng=`) |
| `GET` | `/api/rides/estimate_fare` | Geocode-based fare estimate (`?start=&destination=&seats=`) |
| `POST` | `/api/rides/post` | Post a ride (driver only; fare auto-calculated from coordinates) |
| `GET` | `/api/rides/list` | List all rides (includes `fare`, `per_seat_cost`, `ride_type`) |
| `POST` | `/api/driver/location` | Broadcast driver location (verified drivers only) |
| `GET` | `/api/driver/locations` | All active verified driver locations |

### Messaging & Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dm/conversations` | List DM conversations (supports `?search=`) |
| `GET` | `/api/dm/contacts` | Previously communicated users |
| `POST` | `/api/dm/send` | Send a direct message |
| `GET` | `/api/notifications` | Fetch notifications (with `unread` count) |
| `PUT` | `/api/notifications/read_all` | Mark all notifications read |

### Socket.IO Events

| Direction | Event | Description |
|-----------|-------|-------------|
| Server → Client | `progress` | yt-dlp download progress |
| Server → Client | `new_ride` | New ride posted (real-time) |
| Server → Client | `ride_chat_message` | New chat message |
| Server → Client | `driver_nearby` | Driver location broadcast |
| Server → Client | `driver_arrived` | Driver arrival alert to passengers |
| Server → Client | `dm_notification` | New direct message received |
| Client → Server | `join_ride_chat` | Join a ride's chat room |
| Client → Server | `identify` | Register socket with user ID |

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | random | Flask/FastAPI session secret — set in production |
| `DOWNLOAD_FOLDER` | `downloads` | Directory for saved files |
| `ALLOWED_ORIGINS` | `*` | CORS origins — restrict in production |
| `PORT` | `5000` | Server port |
| `FARE_PER_KM` | `1.0` | Base fare rate (USD) per kilometre |
| `DATABASE_URL` | *(SQLite)* | PostgreSQL connection string |
| `SMTP_HOST` | — | SMTP server for email notifications |
| `NOMINATIM_URL` | public OSM | Custom Nominatim geocoder URL |

---

## Docker

```bash
docker build -t yotweek .
docker run -p 5000:5000 yotweek
```

---

## Troubleshooting

### ❌ Bot detection / "This video cannot be downloaded right now"

YouTube may challenge automated requests. The app automatically retries with alternative player clients (`web_embedded`, `tv`, `android_vr`). If retries fail, upload a `cookies.txt` file via **Admin → Cookies**.

See the [yt-dlp cookies FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp) for export instructions.

### ❌ HTTP 403 Forbidden

The downloader retries with cookieless CDN clients before reporting failure. Supplying a `cookies.txt` file resolves most persistent 403 errors.

### ❌ Tourist Sites not loading

Tourist site discovery uses the public Overpass API. If you see no results, allow location access in your browser and try zooming out the search radius. If the Overpass API is temporarily unavailable, a fallback list of popular global landmarks is shown.

---

## Platform Sections

| Section | Route | Description |
|---------|-------|-------------|
| Home | `/` | Overview, quick tools, ride share embed |
| Dashboard | `/dashboard` | Personal hub: downloads, rides, inbox, history |
| Ride Share | `/rides` | Post rides (drivers) and find available rides (passengers) |
| Tourist Sites | `/tourist-sites` | Location-based tourist attraction discovery |
| Profile | `/profile` | Account settings, avatar, location, driver status |
| Admin | `/admin/dashboard` | Platform analytics (admin only) |

---

## License

This project is provided as-is for personal and educational use.
