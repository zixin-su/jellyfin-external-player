# Requirements Summary

This document summarizes the product requirements captured during the initial implementation.

## Goal

Build a Windows-friendly Jellyfin client that keeps Jellyfin Web as the primary UI, but opens media in an external desktop player when the user clicks playback controls.

## User Requirements

1. The client should be a browser shell around Jellyfin Web.
2. The user should log in through the original Jellyfin Web page.
3. The app should provide a settings page for:
   - Jellyfin server URL.
   - External player executable path.
   - External player argument template.
   - Playback interception switch.
   - Playback source mode: Jellyfin stream, direct path, or helper service.
   - STRM/local path/helper service behavior.
   - Mouse wheel direction correction.
4. When an external player is configured, clicking Jellyfin playback should launch that player.
5. If a media item is backed by STRM, the client should avoid relying only on the local `.strm` file because the client PC may not be able to access the NAS path.
6. The default playback target should be the Jellyfin HTTP stream URL, so external players can stream through Jellyfin.
7. If direct file access is desired, direct path mode and optional path mapping should still be available.
8. If the client cannot access NAS/Jellyfin local paths, the app should support a helper service beside NAS/Jellyfin. The helper reads plain video files or `.strm` targets and exposes HTTP Range streams.
9. Poster center play buttons and detail page play buttons should be intercepted.
10. Non-play actions must keep their Jellyfin behavior:
   - Favorite.
   - Watched status.
   - More menu.
   - Detail page toolbar actions other than play.
11. Series and season poster play buttons should follow Jellyfin-style behavior:
    - Series: play Next Up if available, otherwise the first episode.
    - Season: play unfinished episode, then unplayed episode, then first episode.
12. Login state and settings should migrate between packaged builds when the app folder is copied or updated.
13. Zoom shortcuts should work consistently:
    - `Ctrl+-` zoom out.
    - `Ctrl+=` / `Ctrl++` zoom in.
    - `Ctrl+0` reset zoom.
14. Mouse wheel direction should match the user's expected browser behavior, with a setting to disable the correction if needed.
15. Generated runtime data, caches, and release staging files must not be committed to source control.
16. The app UI should default to Chinese, with English documentation available manually.
17. When the Jellyfin server is not configured or cannot be opened, the home screen should show a clear hint and only one button that opens settings.
18. Saving settings should close the settings window and show an auto-dismissing confirmation in the main window.

## Non-goals

- Reimplement Jellyfin Web UI.
- Replace Jellyfin authentication.
- Build a custom media player.
- Require direct client access to NAS paths; Jellyfin stream mode or the NAS helper service can be used when direct access is unavailable.
- Upload user login state, cookies, cache, settings, or local media paths to the public repository.

## Current Behavior

- The app injects a preload script into Jellyfin Web.
- The preload script detects real play controls and sends playback requests to the Electron main process.
- The main process uses Jellyfin APIs to resolve metadata, playback info, series Next Up, and season episodes.
- The main process launches the configured external player with the resolved target URL/path.
- By default, Jellyfin HTTP stream URLs are used instead of direct file paths.
- Users can switch to direct path mode or helper service mode.
