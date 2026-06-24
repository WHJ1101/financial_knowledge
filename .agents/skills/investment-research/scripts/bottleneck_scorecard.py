#!/usr/bin/env python3
"""Score an investment candidate by scarce-layer research priority.

Adapted for this project from the MIT-licensed muxuuu/serenity-skill
scorecard idea. It is a local helper, not a trading model.

Usage:
  python scripts/bottleneck_scorecard.py --template
  python scripts/bottleneck_scorecard.py scorecard.json --format md
  cat scorecard.json | python scripts/bottleneck_scorecard.py - --format both
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any


WEIGHTS = {
    "demand_inflection": 15,
    "architecture_coupling": 10,
    "scarce_layer_severity": 15,
    "supplier_concentration": 12,
    "expansion_difficulty": 12,
    "evidence_quality": 15,
    "valuation_disconnect": 11,
    "near_term_repricing": 10,
}

PENALTY_MULTIPLIER = 2.0

TEMPLATE = {
    "ticker": "EXAMPLE",
    "company": "Example Co",
    "market": "A-share/HK/US/Taiwan/Japan/Korea/Europe",
    "factors": {key: 0 for key in WEIGHTS},
    "penalties": {
        "dilution_financing": 0,
        "governance": 0,
        "geopolitics": 0,
        "liquidity": 0,
        "hype_risk": 0,
        "accounting_quality": 0,
        "cyclicality": 0,
        "alternative_design_risk": 0,
    },
    "evidence": [
        {
            "claim": "",
            "source": "",
            "strength": "strong/medium/weak/needs_checking",
        }
    ],
    "what_could_weaken_view": ["", "", ""],
}


def number_0_to_5(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number from 0 to 5") from exc
    if number < 0 or number > 5:
        raise ValueError(f"{label} must be from 0 to 5; got {number}")
    return number


def load_input(path: str) -> dict[str, Any]:
    raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("Input JSON must be an object")
    return data


def score(data: dict[str, Any]) -> dict[str, Any]:
    factors = data.get("factors", {})
    penalties = data.get("penalties", {})
    factor_details: dict[str, dict[str, float]] = {}
    total = 0.0

    for key, weight in WEIGHTS.items():
        rating = number_0_to_5(factors.get(key, 0), f"factors.{key}")
        points = rating / 5.0 * weight
        factor_details[key] = {
            "rating": rating,
            "weight": float(weight),
            "points": round(points, 2),
        }
        total += points

    penalty_details: dict[str, dict[str, float]] = {}
    penalty_total = 0.0
    for key, value in penalties.items():
        rating = number_0_to_5(value, f"penalties.{key}")
        points = rating * PENALTY_MULTIPLIER
        penalty_details[key] = {"rating": rating, "points": round(points, 2)}
        penalty_total += points

    final_score = max(0.0, min(100.0, total - penalty_total))
    if final_score >= 85:
        verdict = "Top research priority"
    elif final_score >= 70:
        verdict = "High research priority"
    elif final_score >= 55:
        verdict = "Worth tracking"
    else:
        verdict = "Early lead or low priority"

    return {
        "ticker": data.get("ticker", ""),
        "company": data.get("company", ""),
        "market": data.get("market", ""),
        "raw_factor_points": round(total, 2),
        "penalty_points": round(penalty_total, 2),
        "final_score": round(final_score, 2),
        "verdict": verdict,
        "factor_details": factor_details,
        "penalty_details": penalty_details,
        "what_could_weaken_view": data.get("what_could_weaken_view", []),
        "evidence": data.get("evidence", []),
    }


def to_markdown(result: dict[str, Any]) -> str:
    title_bits = [result.get("ticker") or "Unknown"]
    if result.get("company"):
        title_bits.append(f"({result['company']})")
    title = " ".join(title_bits)

    lines = [
        f"# Bottleneck scorecard: {title}",
        "",
        f"Market: {result.get('market', '')}",
        f"Final score: **{result['final_score']} / 100**",
        f"Verdict: **{result['verdict']}**",
        f"Raw factor points: {result['raw_factor_points']}",
        f"Penalty points: {result['penalty_points']}",
        "",
        "## Factors",
        "| Factor | Rating | Weight | Points |",
        "|---|---:|---:|---:|",
    ]
    for key, detail in result["factor_details"].items():
        lines.append(
            f"| {key} | {detail['rating']} | {detail['weight']} | {detail['points']} |"
        )

    lines.extend(["", "## Penalties", "| Penalty | Rating | Points |", "|---|---:|---:|"])
    for key, detail in result["penalty_details"].items():
        lines.append(f"| {key} | {detail['rating']} | {detail['points']} |")

    weakening_items = [
        str(item).strip()
        for item in result.get("what_could_weaken_view", [])
        if str(item).strip()
    ]
    if weakening_items:
        lines.extend(["", "## What could weaken the view"])
        for item in weakening_items:
            lines.append(f"- {item}")

    evidence_lines = []
    for evidence in result.get("evidence", []):
        if not isinstance(evidence, dict):
            continue
        claim = str(evidence.get("claim", "")).strip()
        source = str(evidence.get("source", "")).strip()
        strength = str(evidence.get("strength", "")).strip()
        if claim or source:
            evidence_lines.append(f"- [{strength}] {claim} - {source}")
    if evidence_lines:
        lines.extend(["", "## Evidence notes"])
        lines.extend(evidence_lines)

    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score a scarce-layer investment research candidate"
    )
    parser.add_argument("input", nargs="?", help="JSON scorecard file, or '-' for stdin")
    parser.add_argument("--template", action="store_true", help="Print a JSON template")
    parser.add_argument("--format", choices=["json", "md", "both"], default="json")
    args = parser.parse_args()

    if args.template:
        print(json.dumps(TEMPLATE, ensure_ascii=False, indent=2))
        return
    if not args.input:
        parser.error("input is required unless --template is used")

    result = score(load_input(args.input))
    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif args.format == "md":
        print(to_markdown(result))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        print("\n---\n")
        print(to_markdown(result))


if __name__ == "__main__":
    main()
