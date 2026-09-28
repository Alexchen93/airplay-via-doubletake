# AirPlay via DoubleTake — GNOME Shell Extension

A small GNOME Shell extension that exposes [`doubletake-ctl`](https://github.com/omarroth/doubletake) from the GNOME top panel.

It is designed for Ubuntu GNOME and GNOME Shell 46+, with no third-party JavaScript dependencies.

> This extension is a control UI for DoubleTake. It does not implement AirPlay itself.

## Features

- Icon-only AirPlay indicator in the GNOME top panel
- `Discover` — ask the DoubleTake daemon to discover AirPlay receivers
- `Devices` — show discovered receivers when the daemon provides a device list
- `Connect` — connect to a discovered receiver
- Manual connection by target IP or hostname
- Optional PIN/password field for manual connection
- `Disconnect` and `Status` controls
- Short status messages instead of raw JSON in the menu
- Clear `No devices found` and `doubletake-ctl was not found in PATH` states
- Asynchronous subprocess calls so the GNOME Shell UI is not blocked

## Requirements

- GNOME Shell 46 or a compatible supported version
- [`doubletake`](https://github.com/omarroth/doubletake) and `doubletake-ctl` installed and available in `PATH`
- A running DoubleTake daemon for `doubletake-ctl` commands
- A standard AirPlay receiver reachable from the same network

DoubleTake itself also needs the GStreamer, PipeWire/PulseAudio, and encoder dependencies described in its upstream README. Intel systems with VA-API H.264 encoding can use DoubleTake's automatic hardware-acceleration selection.

## Install the upstream DoubleTake dependency

Follow the upstream project instructions first:

```sh
git clone https://github.com/omarroth/doubletake.git ~/src/doubletake
cd ~/src/doubletake
make test
make
sudo make install
```

Start the daemon, for example:

```sh
doubletake -daemonize -port-range 60000-60010
```

Use a firewall rule appropriate to your network if you deliberately pin a UDP port range. Do not expose DoubleTake or AirPlay ports to the public Internet.

## Install this extension

From the repository root:

```sh
mkdir -p ~/.local/share/gnome-shell/extensions
cp -a airplay-via-doubletake@local ~/.local/share/gnome-shell/extensions/
gnome-extensions enable airplay-via-doubletake@local
```

Alternatively, install the packaged extension:

```sh
gnome-extensions install --force airplay-via-doubletake@local.shell-extension.zip
gnome-extensions enable airplay-via-doubletake@local
```

On X11, logging out and back in is the safest way to reload the extension. On Wayland, log out and back in after installing or updating it.

Verify it with:

```sh
gnome-extensions info airplay-via-doubletake@local
```

The expected state is `ACTIVE` and `已啟用: 是` on a Chinese-localized system.

## Use

### Automatic discovery

1. Click the AirPlay icon in the GNOME top panel.
2. Click `Discover`.
3. Open `Connect`.
4. Choose a discovered receiver.

### Manual connection

1. Open `AirPlay → Connect`.
2. Enter the receiver IP address or hostname in `Target IP or hostname`.
3. Enter a PIN/password only when the receiver requires it.
4. Click `Connect to target`.

The optional PIN is passed to `doubletake-ctl connect <target> <pin>`. Prefer an environment-based secret such as `DOUBLETAKE_CODE` when appropriate; do not commit PINs, passwords, QR tokens, or credentials to this repository.

## Hotel and QR-code AirPlay limitations

Many hotel TVs use a QR-code onboarding flow, a captive portal, a room-specific token, or a vendor-specific casting service. Such a TV may display the word “AirPlay” without advertising a standard `_airplay._tcp` service on the local network.

In that case:

- `Discover` may correctly return no devices.
- Manual IP connection may still fail if the hotel network isolates clients.
- Completing the QR flow on a phone does not necessarily authorize a Linux desktop.
- This extension cannot bypass hotel authorization, client isolation, or a proprietary casting protocol.

Check the hotel's terms and use only the receiver and network access provided for your room.

## Troubleshooting

### The AirPlay icon is missing

```sh
gnome-extensions info airplay-via-doubletake@local
gnome-extensions enable airplay-via-doubletake@local
```

Then log out and back in. Check GNOME Shell logs:

```sh
journalctl --user -f -o cat /usr/bin/gnome-shell
```

### The menu says `doubletake-ctl was not found in PATH`

Check:

```sh
command -v doubletake-ctl
doubletake-ctl status
```

GNOME Shell may have a different `PATH` from your terminal. Install `doubletake-ctl` in `/usr/local/bin`, or ensure the GNOME session can see its installation directory.

### No devices are found

Check that:

- The receiver is powered on and AirPlay is enabled.
- Desktop and receiver are on the same LAN/VLAN.
- The hotel/router does not use client isolation.
- mDNS/Bonjour discovery is not blocked.
- The receiver is a standard AirPlay receiver, not only a vendor-specific QR casting service.

The extension intentionally converts status JSON such as `{ok,state,has_audio,audio_muted}` into short text and does not treat it as a device list.

## Development

The extension is intentionally small:

- `metadata.json` — extension metadata and supported GNOME Shell versions
- `extension.js` — panel indicator, menu, subprocess calls, discovery, and manual connection

Check the packaged extension:

```sh
gnome-extensions pack --force airplay-via-doubletake@local
unzip -l airplay-via-doubletake@local.shell-extension.zip
```

Live GNOME Shell loading must be tested inside an active GNOME session. A plain `gjs` invocation may fail at `resource:///org/gnome/shell/...` imports; that is expected outside GNOME Shell.

## Desktop AirPlay tuning record (2026-09-28)

On Alexchen Desktop, the DoubleTake user service was verified with an X11 screen-capture environment and the following conservative profile:

```text
-daemonize -x11-window-id 0x4af -hwaccel none -fps 15 -bitrate 1800 -no-audio
```

Latency testing used `-target-latency-ms` in this order: `2000` → `800` → `500` → `300`. The fixed `300ms` setting reduced perceived delay and remained stable during the attended test. The current experiment uses `-target-latency-ms 0`, which means automatic AirPlay policy rather than guaranteed zero latency. If automatic mode increases delay or becomes unstable, restore the fixed `300` value. Service backups were kept on the Desktop outside this repository.

The service and receiver were verified with `systemctl --user is-active doubletake.service`, `doubletake-ctl status`, and `doubletake-ctl discover`. Do not commit PINs, passwords, QR tokens, or other credentials.

## Roadmap

- Improve manual target/PIN field layout and keyboard focus.
- Add explicit discovery timeout and progress feedback.
- Add a safe credential flow that avoids exposing PINs in process arguments.
- Add diagnostics for mDNS, client isolation, and receiver reachability.
- Add a systemd user service for DoubleTake daemon lifecycle.
- Add encoder, FPS, bitrate, and audio fallback settings.
- Add mock `doubletake-ctl` responses for UI regression tests.
- Consider a standalone GTK4/libadwaita control panel if GNOME Shell APIs change.

## License

This extension is provided as a small integration project. Check the upstream DoubleTake project for its license and terms. Add a repository license before redistributing this extension as a packaged product.
