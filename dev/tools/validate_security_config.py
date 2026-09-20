#!/usr/bin/env python3
"""Validate nLab private users.json security configuration without needing secrets."""

from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

def fail(msg: str) -> None:
    raise ValueError(msg)

def validate(data: dict) -> None:
    if data.get("default_policy") != "deny":
        fail("default_policy must be 'deny'")
    roles = data.get("roles")
    users = data.get("users")
    if not isinstance(roles, dict) or not roles:
        fail("roles must be a non-empty object")
    if not isinstance(users, list):
        fail("users must be an array")

    for role, perms in roles.items():
        if not isinstance(role, str) or not role.strip():
            fail("role names must be non-empty strings")
        if not isinstance(perms, list) or not all(isinstance(p, str) and p.strip() for p in perms):
            fail(f"role {role!r} must contain string permissions")

    seen = set()
    for i, user in enumerate(users):
        if not isinstance(user, dict):
            fail(f"users[{i}] must be an object")
        email = str(user.get("email", "")).strip().lower()
        if "@" not in email:
            fail(f"users[{i}].email is invalid")
        if email in seen:
            fail(f"duplicate email: {email}")
        seen.add(email)
        if user.get("active") not in (True, False):
            fail(f"{email}: active must be boolean")
        uroles = user.get("roles")
        if not isinstance(uroles, list) or not uroles:
            fail(f"{email}: roles must be a non-empty array")
        unknown = [r for r in uroles if r not in roles]
        if unknown:
            fail(f"{email}: unknown roles: {', '.join(unknown)}")
        extra = user.get("permissions", [])
        if not isinstance(extra, list) or not all(isinstance(p, str) and p.strip() for p in extra):
            fail(f"{email}: permissions must be an array of strings")

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=Path)
    ns = ap.parse_args()
    try:
        data = json.loads(ns.file.read_text(encoding="utf-8"))
        validate(data)
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"OK: {ns.file} ({len(data['users'])} users, {len(data['roles'])} roles)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
