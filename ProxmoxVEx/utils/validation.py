# --- ProxmoxVEx auto-header start ---
# --------------------------------------------------------------------
# File:        ProxmoxVEx/utils/validation.py
# Project:     ProxmoxVEx
# Version:     1.2.303
# Build:       2026.09.04
# Description: Light-weight JSON body validation decorator for Flask...
# Docs:        https://proxmoxvex.local/docs
# Generated:   2026-09-04
# --------------------------------------------------------------------
# --- ProxmoxVEx auto-header end ---
"""Light-weight JSON body validation decorator for Flask endpoints."""

from functools import wraps
from typing import Any, Callable

from flask import jsonify, request


def _type_name(t: Any) -> str:
    if isinstance(t, type):
        return t.__name__
    return str(t)


def validate_body(schema: dict[str, dict[str, Any]], allow_unknown: bool = True) -> Callable:
    """Decorator that validates a JSON request body against a simple schema.

    schema example:
        {
            "username": {"required": True, "type": str},
            "role": {"required": False, "type": str, "default": "viewer"},
        }
    """

    def decorator(f: Callable) -> Callable:
        @wraps(f)
        def wrapper(*args, **kwargs):
            data = request.get_json(silent=True)
            if data is None:
                return jsonify({"error": "Expected JSON body"}), 415
            if not isinstance(data, dict):
                return jsonify({"error": "Expected JSON object"}), 422

            errors = []
            validated = {}
            for key, spec in schema.items():
                is_required = spec.get("required", False)
                expected_type = spec.get("type")
                default = spec.get("default")

                if key not in data:
                    if is_required:
                        errors.append(f"{key}: required")
                    elif default is not None:
                        validated[key] = default
                    continue

                value = data[key]
                if expected_type is not None and not isinstance(value, expected_type):
                    errors.append(f"{key}: expected {_type_name(expected_type)}, got {_type_name(type(value))}")
                    continue

                validated[key] = value

            if not allow_unknown:
                for key in data:
                    if key not in schema:
                        errors.append(f"{key}: unknown field")

            if errors:
                return jsonify({"error": "; ".join(errors), "details": errors}), 400

            request.validated = validated
            return f(*args, **kwargs)

        return wrapper

    return decorator
