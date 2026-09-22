#!/usr/bin/env python3
"""Validate version.json against version.schema.json (spec 093/US021).

Release metadata is a trust boundary — a malformed field (bad semver, missing
version, wrong date) breaks every client's update resolution, so CI fails
closed here and names the offending field.

Usage: validate-version.py [version.json]   (schema defaults to the repo's
version.schema.json; exit 0 valid, 1 invalid/missing file)
"""
import json
import os
import re
import sys
import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _check(doc, schema, path=""):
    """Minimal subset validator: type/required/properties/pattern/const/
    items/additionalProperties/format:date — enough for this schema without
    depending on the jsonschema package being installed in CI."""
    t = schema.get("type")
    if t == "object" and not isinstance(doc, dict):
        return [f"{path or '<root>'}: expected object"]
    if t == "array" and not isinstance(doc, list):
        return [f"{path or '<root>'}: expected array"]
    if t == "string" and not isinstance(doc, str):
        return [f"{path}: expected string"]

    errs = []
    if "const" in schema and doc != schema["const"]:
        errs.append(f"{path}: expected {schema['const']!r}")
    if "pattern" in schema and isinstance(doc, str):
        if not re.match(schema["pattern"], doc):
            errs.append(f"{path}: {doc!r} does not match {schema['pattern']!r}")
    if schema.get("format") == "date" and isinstance(doc, str):
        try:
            datetime.date.fromisoformat(doc)
        except ValueError:
            errs.append(f"{path}: {doc!r} is not an ISO date")
    if isinstance(doc, dict):
        for req in schema.get("required", []):
            if req not in doc:
                errs.append(f"{path or '<root>'}: missing required field '{req}'")
        for key, sub in schema.get("properties", {}).items():
            if key in doc:
                p = f"{path}.{key}" if path else key
                errs += _check(doc[key], sub, p)
        addl = schema.get("additionalProperties")
        if isinstance(addl, dict):
            declared = set(schema.get("properties", {}))
            for key in doc:
                if key not in declared:
                    p = f"{path}.{key}" if path else key
                    errs += _check(doc[key], addl, p)
    if isinstance(doc, list) and isinstance(schema.get("items"), dict):
        for i, item in enumerate(doc):
            errs += _check(item, schema["items"], f"{path}[{i}]")
    return errs


def main():
    doc_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "version.json")
    schema_path = os.path.join(REPO, "version.schema.json")
    try:
        doc = json.load(open(doc_path))
    except (OSError, json.JSONDecodeError) as e:
        print(f"FAIL: cannot read {doc_path}: {e}")
        return 1
    schema = json.load(open(schema_path))
    errs = _check(doc, schema)
    if errs:
        for e in errs:
            print(f"FAIL: {e}")
        return 1
    print(f"OK: {os.path.basename(doc_path)} valid against version.schema.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
