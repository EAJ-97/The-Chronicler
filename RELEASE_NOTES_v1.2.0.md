# The Chronicler — Release v1.2.0

**Date:** 2026-04-14

## Summary

This release adds a guided **tutorial mode** with spotlight overlays, reworks **demo data tenancy** (no seeded demo user accounts), and aligns the **Admin DEMO** experience with the new model. Non-admin users can explore demo campaigns as DMs with **read-only** demo mutations while still seeing DM-oriented UI (icons, AI tools, continuity).

## Demo model

- Demo content is **admin-owned** and generated from **Admin → DEMO**; `demo_seeded` is exposed on auth (`/login`, `/register`, `/auth/me`) so the client can gate the tutorial immediately.
- **All users** receive DM folder roles on demo roots; **non-admins** cannot mutate demo-backed data (server-enforced across notes, connections, journal, images, recaps, snapshots, AI tools, etc.).
- Central helpers live in `backend/utils/demoAccess.js` (visibility, DM sync, mutation checks).

## Tutorial

- **TutorialOverlay**: chapter/subsection labels, danger highlight for backup actions, **interaction lock** (only the tutorial card receives input while open).
- **Orchestrated steps** in `frontend/src/tutorial/tutorialSteps.js`: Admin (per tab), Vault, Notes (Sunken Vale–centric), Web (graph toolbar, legend tab, 3D controls), Journal, Backups (root actions), and a **Users** chapter for non-admins (user menu items).
- **Demo gating**: if demo is not seeded, admins see a gate step pointing at DEMO generate; non-admins are told to ask an admin. Optional admin-only path when demo is missing.
- **Graph tutorial**: Web chapter forces **2D** until the 3D controls step, then forces **3D** for the controls spotlight.
- **User menu**: Tutorial / hide demo folders (when applicable) / Trash / Leave — with refs for accurate highlights on desktop and mobile.

## Admin & UI

- **AdminPanel**: `forwardRef` + imperative tab switching for the tutorial; DEMO tab copy explains the new model (no fictional “demo accounts” list).
- **NoteEditor**: Demo showcase banner; DM tabs visible for non-admins on demo roots with controls disabled when read-only.
- **Preferences**: “Hide demo folders” persists via localStorage; tutorial can temporarily override for demo-driven steps.

## Upgrade notes

- Existing installs: **no database migration** required for this feature set beyond your current migration chain; generate or re-generate demo from Admin if you want the full tutorial and sample campaign.
- After deploy, admins may use **Admin → DEMO → Generate** once if `demo_seeded` is false and they want the guided tour plus sample data.

## Version

- Application semver bumped to **1.2.0** in `frontend/package.json` and `backend/package.json` (used for in-app update checks against GitHub releases).
