#!/usr/bin/env python3
"""
viz-crop Pricing Calculator
============================
Calculates the annual and monthly cost of running viz-crop for a given
number of users, field size (acres), and NDVI scans per year.

Layers costed:
  Layer 1+2  ArcGIS Location Platform — satellite basemap + labels
             (session model AND tile model — both shown for comparison)
  Layer 3    Copernicus Data Space Ecosystem — Sentinel Hub NDVI / dpRVI

Layers NOT costed (open source, $0):
  Layer 4    Field polygon — terra-draw + MapLibre GL JS (MIT / BSD)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Official pricing sources (verified May 2026):
  ArcGIS Location Platform — pricing page
    https://location.arcgis.com/pricing/

  ArcGIS Location Platform — billing documentation
    https://location.arcgis.com/help/billing/

  ArcGIS basemap sessions announcement (Oct 2025)
    https://www.esri.com/arcgis-blog/products/platform/announcements/basemap-sessions

  Copernicus Data Space Ecosystem — portal & free tier info
    https://dataspace.copernicus.eu/

  Copernicus Sentinel Hub PU Calculator — official benchmark source
    https://dataspace.copernicus.eu/cases/sentinel-hub-pu-calculator-demystifying-your-costs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import sys
import math


# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS — all figures sourced from official documentation (see header)
# ─────────────────────────────────────────────────────────────────────────────

# ArcGIS Location Platform — Session model
# Source: https://location.arcgis.com/help/billing/
#         https://www.esri.com/arcgis-blog/products/platform/announcements/basemap-sessions
ARCGIS_SESSION_FREE_TIER_MONTHLY   = 1_000        # sessions/month, free
ARCGIS_SESSION_COST_PER_1000       = 4.00         # USD per 1,000 sessions beyond free tier
ARCGIS_SESSION_DURATION_HOURS      = 12           # a session covers 12 hours of unlimited tiles

# ArcGIS Location Platform — Tile model
# Source: https://location.arcgis.com/help/billing/
ARCGIS_TILE_FREE_TIER_MONTHLY      = 2_000_000    # tiles/month, free
ARCGIS_TILE_COST_PER_1000          = 0.15         # USD per 1,000 tiles beyond free tier
ARCGIS_TILES_PER_SESSION_ESTIMATE  = 80           # estimated tiles per user visit (zoom 14–16,
                                                  # agronomist panning over one field)

# Copernicus Data Space Ecosystem — Sentinel Hub Processing Units
# Source: https://dataspace.copernicus.eu/cases/sentinel-hub-pu-calculator-demystifying-your-costs
#
# Official benchmark (from the PU Calculator blog article):
#   Vienna area      = 413 km²
#   1 NDVI image     = 34 PU   (Sentinel-2, 2 bands, 32-bit, 10 m resolution)
#   26 images / year = 886 PU
#
COPERNICUS_FREE_TIER_PU_MONTHLY    = 10_000       # PU/month, General (free) account
COPERNICUS_VIENNA_AREA_KM2         = 413.0        # reference area in km²
COPERNICUS_VIENNA_PU_PER_IMAGE     = 34.0         # PU for 1 NDVI image over Vienna

# Unit conversion
ACRES_TO_KM2                       = 0.00404686   # 1 acre = 0.00404686 km²


# ─────────────────────────────────────────────────────────────────────────────
# CALCULATION FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def acres_to_km2(acres: float) -> float:
    """Convert acres to square kilometres."""
    return acres * ACRES_TO_KM2


def copernicus_pu_per_scan(acres: float) -> float:
    """
    Calculate Sentinel Hub Processing Units consumed per single NDVI scan
    over a field of the given size.

    Method: proportional scaling from the official Vienna benchmark.
      PU = VIENNA_PU_PER_IMAGE × (field_area_km2 / VIENNA_AREA_KM2)

    Source: Copernicus PU Calculator blog
    https://dataspace.copernicus.eu/cases/sentinel-hub-pu-calculator-demystifying-your-costs
    """
    field_km2 = acres_to_km2(acres)
    return COPERNICUS_VIENNA_PU_PER_IMAGE * (field_km2 / COPERNICUS_VIENNA_AREA_KM2)


def copernicus_annual_cost(users: int, acres: float, scans_per_year: int) -> dict:
    """
    Calculate annual Copernicus NDVI cost.

    Returns a dict with full breakup.
    Note: Commercial tier pricing beyond the free tier is not publicly listed
    by Copernicus — they direct users to CREODIAS for quotes. When the free
    tier is exceeded this calculator flags it and directs to the official page.
    """
    pu_per_scan       = copernicus_pu_per_scan(acres)
    total_scans_year  = users * scans_per_year
    total_pu_year     = total_scans_year * pu_per_scan
    total_pu_month    = total_pu_year / 12

    free_tier_annual  = COPERNICUS_FREE_TIER_PU_MONTHLY * 12
    free_tier_pct     = min((total_pu_year / free_tier_annual) * 100, 9999)

    within_free_tier  = total_pu_month <= COPERNICUS_FREE_TIER_PU_MONTHLY
    billable_pu_month = max(0.0, total_pu_month - COPERNICUS_FREE_TIER_PU_MONTHLY)
    billable_pu_year  = billable_pu_month * 12

    # Copernicus does not publish per-PU commercial rates publicly.
    # Users exceeding the free tier must contact CREODIAS for a quote.
    annual_cost_usd   = 0.0 if within_free_tier else None

    return {
        "pu_per_scan":        round(pu_per_scan, 6),
        "total_scans_year":   total_scans_year,
        "total_pu_year":      round(total_pu_year, 4),
        "total_pu_month":     round(total_pu_month, 4),
        "free_tier_pu_month": COPERNICUS_FREE_TIER_PU_MONTHLY,
        "free_tier_pct_used": round(free_tier_pct, 4),
        "within_free_tier":   within_free_tier,
        "billable_pu_year":   round(billable_pu_year, 4),
        "annual_cost_usd":    annual_cost_usd,   # None = contact Copernicus for quote
    }


def arcgis_session_annual_cost(users: int, scans_per_year: int) -> dict:
    """
    Calculate annual ArcGIS basemap cost using the session usage model.

    One scan = one app visit = one 12-hour session (unlimited tiles).
    Source: https://location.arcgis.com/help/billing/
    """
    total_sessions_year  = users * scans_per_year
    total_sessions_month = total_sessions_year / 12

    free_tier_annual     = ARCGIS_SESSION_FREE_TIER_MONTHLY * 12
    free_tier_pct        = min((total_sessions_year / free_tier_annual) * 100, 9999)

    within_free_tier     = total_sessions_month <= ARCGIS_SESSION_FREE_TIER_MONTHLY
    billable_month       = max(0.0, total_sessions_month - ARCGIS_SESSION_FREE_TIER_MONTHLY)
    monthly_cost         = (billable_month / 1000) * ARCGIS_SESSION_COST_PER_1000
    annual_cost          = monthly_cost * 12

    return {
        "model":                  "Session",
        "total_sessions_year":    total_sessions_year,
        "total_sessions_month":   round(total_sessions_month, 2),
        "free_tier_month":        ARCGIS_SESSION_FREE_TIER_MONTHLY,
        "free_tier_pct_used":     round(free_tier_pct, 4),
        "within_free_tier":       within_free_tier,
        "billable_sessions_month":round(billable_month, 2),
        "monthly_cost_usd":       round(monthly_cost, 4),
        "annual_cost_usd":        round(annual_cost, 4),
        "rate":                   f"${ARCGIS_SESSION_COST_PER_1000:.2f} per 1,000 sessions",
    }


def arcgis_tile_annual_cost(users: int, scans_per_year: int) -> dict:
    """
    Calculate annual ArcGIS basemap cost using the tile usage model.

    Tiles per session is an estimate for a crop monitoring app (user zooms
    into one field at zoom 14–16, pans slightly = ~80 tiles).
    Source: https://location.arcgis.com/help/billing/
    """
    total_sessions_year  = users * scans_per_year
    total_tiles_year     = total_sessions_year * ARCGIS_TILES_PER_SESSION_ESTIMATE
    total_tiles_month    = total_tiles_year / 12

    free_tier_annual     = ARCGIS_TILE_FREE_TIER_MONTHLY * 12
    free_tier_pct        = min((total_tiles_year / free_tier_annual) * 100, 9999)

    within_free_tier     = total_tiles_month <= ARCGIS_TILE_FREE_TIER_MONTHLY
    billable_month       = max(0.0, total_tiles_month - ARCGIS_TILE_FREE_TIER_MONTHLY)
    monthly_cost         = (billable_month / 1000) * ARCGIS_TILE_COST_PER_1000
    annual_cost          = monthly_cost * 12

    return {
        "model":                "Tile",
        "tiles_per_session":    ARCGIS_TILES_PER_SESSION_ESTIMATE,
        "total_tiles_year":     int(total_tiles_year),
        "total_tiles_month":    round(total_tiles_month, 2),
        "free_tier_month":      ARCGIS_TILE_FREE_TIER_MONTHLY,
        "free_tier_pct_used":   round(free_tier_pct, 4),
        "within_free_tier":     within_free_tier,
        "billable_tiles_month": round(billable_month, 2),
        "monthly_cost_usd":     round(monthly_cost, 4),
        "annual_cost_usd":      round(annual_cost, 4),
        "rate":                 f"${ARCGIS_TILE_COST_PER_1000:.2f} per 1,000 tiles",
    }


# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT HELPERS
# ─────────────────────────────────────────────────────────────────────────────

WIDTH = 68

def line(char="─"):
    print(char * WIDTH)

def header(text):
    print()
    line("━")
    print(f"  {text}")
    line("━")

def section(text):
    print()
    line()
    print(f"  {text}")
    line()

def row(label, value, indent=2):
    dots = "." * (WIDTH - indent - len(label) - len(str(value)) - 2)
    print(f"{'  ' * indent}{label} {dots} {value}")

def free_bar(pct: float, width: int = 40) -> str:
    """ASCII progress bar showing free tier utilisation."""
    filled = min(int((pct / 100) * width), width)
    bar    = "█" * filled + "░" * (width - filled)
    return f"[{bar}] {pct:.4f}%"

def fmt_cost(cost_usd) -> str:
    if cost_usd is None:
        return "Contact Copernicus (see note)"
    if cost_usd == 0.0:
        return "$0.00  ✓ within free tier"
    return f"${cost_usd:,.4f}"

def fmt_usd(val: float) -> str:
    return f"${val:,.4f}"


# ─────────────────────────────────────────────────────────────────────────────
# MAIN REPORT
# ─────────────────────────────────────────────────────────────────────────────

def print_report(users: int, acres: float, scans_per_year: int):

    cop   = copernicus_annual_cost(users, acres, scans_per_year)
    arc_s = arcgis_session_annual_cost(users, scans_per_year)
    arc_t = arcgis_tile_annual_cost(users, scans_per_year)

    # Choose the recommended model (session is better for viz-crop use case)
    recommended = arc_s

    print()
    print("=" * WIDTH)
    print("  VIZ-CROP  —  ANNUAL PRICING CALCULATOR".center(WIDTH))
    print("=" * WIDTH)

    # ── Inputs ────────────────────────────────────────────────────────────────
    section("INPUTS")
    row("Users",                   f"{users:,}")
    row("Field size per user",     f"{acres:,.1f} acres  ({acres_to_km2(acres):.4f} km²)")
    row("NDVI scans per user / year", f"{scans_per_year}")
    row("Total scans / year",      f"{users * scans_per_year:,}")
    row("Total scans / month",     f"{users * scans_per_year / 12:,.2f}")

    # ── Layer 3: Copernicus ───────────────────────────────────────────────────
    header("LAYER 3  —  COPERNICUS  (NDVI / dpRVI via Sentinel Hub)")

    print(f"\n  Pricing source:")
    print(f"    https://location.arcgis.com/pricing/")
    print(f"  PU benchmark source (official Copernicus blog):")
    print(f"    https://dataspace.copernicus.eu/cases/")
    print(f"    sentinel-hub-pu-calculator-demystifying-your-costs")

    section("  PU calculation method")
    row("Vienna reference area",       "413 km²",              indent=1)
    row("PU per NDVI image (Vienna)",  "34 PU",                indent=1)
    row("Your field area",             f"{acres_to_km2(acres):.6f} km²", indent=1)
    row("PU per scan (your field)",
        f"34 × ({acres_to_km2(acres):.6f} / 413) = {cop['pu_per_scan']:.6f} PU",
        indent=1)

    section("  Annual usage")
    row("Total scans / year",       f"{cop['total_scans_year']:,}")
    row("Total PU / year",          f"{cop['total_pu_year']:,.4f} PU")
    row("Average PU / month",       f"{cop['total_pu_month']:,.4f} PU")
    row("Free tier",                f"{cop['free_tier_pu_month']:,} PU / month")
    print()
    print(f"  Free tier utilisation (monthly avg):")
    print(f"    {free_bar(cop['free_tier_pct_used'])}")

    section("  Cost")
    if cop['within_free_tier']:
        print(f"  ✓  WITHIN FREE TIER  —  Annual cost: $0.00")
        print(f"     Using {cop['free_tier_pct_used']:.4f}% of the 10,000 PU/month free allowance.")
    else:
        print(f"  ⚠  EXCEEDS FREE TIER")
        print(f"     Billable PU / year  : {cop['billable_pu_year']:,.2f} PU")
        print(f"     Copernicus does not publish commercial per-PU rates publicly.")
        print(f"     Contact CREODIAS for a commercial quote:")
        print(f"     https://creodias.eu/")

    # ── Layer 1+2: ArcGIS ────────────────────────────────────────────────────
    header("LAYER 1+2  —  ARCGIS LOCATION PLATFORM  (Satellite basemap + labels)")

    print(f"\n  Pricing source:")
    print(f"    https://location.arcgis.com/pricing/")
    print(f"  Billing docs:")
    print(f"    https://location.arcgis.com/help/billing/")

    # Session model
    section("  Option A — Session usage model  ← RECOMMENDED for viz-crop")
    print(f"  One scan = one app visit = one 12-hour session (unlimited tiles).")
    print(f"  Best for apps where users spend time zooming into one field.")
    print()
    row("Total sessions / year",    f"{arc_s['total_sessions_year']:,}")
    row("Average sessions / month", f"{arc_s['total_sessions_month']:,.2f}")
    row("Free tier",                f"{arc_s['free_tier_month']:,} sessions / month")
    print()
    print(f"  Free tier utilisation (monthly avg):")
    print(f"    {free_bar(arc_s['free_tier_pct_used'])}")
    print()
    if arc_s['within_free_tier']:
        print(f"  ✓  WITHIN FREE TIER")
        print(f"     Billable sessions / month : 0")
        row("Monthly cost",  "$0.00")
        row("Annual cost",   "$0.00")
    else:
        print(f"  ⚠  EXCEEDS FREE TIER")
        row("Billable sessions / month", f"{arc_s['billable_sessions_month']:,.2f}")
        row("Rate",                       arc_s['rate'])
        row("Monthly cost",               fmt_usd(arc_s['monthly_cost_usd']))
        row("Annual cost",                fmt_usd(arc_s['annual_cost_usd']))

    # Tile model
    section("  Option B — Tile usage model  (shown for comparison)")
    print(f"  Each tile loaded by MapLibre is charged separately.")
    print(f"  Estimate: ~{arc_t['tiles_per_session']} tiles per user visit (zoom 14-16, one field).")
    print()
    row("Total tiles / year",       f"{arc_t['total_tiles_year']:,}")
    row("Average tiles / month",    f"{arc_t['total_tiles_month']:,.2f}")
    row("Free tier",                f"{arc_t['free_tier_month']:,} tiles / month")
    print()
    print(f"  Free tier utilisation (monthly avg):")
    print(f"    {free_bar(arc_t['free_tier_pct_used'])}")
    print()
    if arc_t['within_free_tier']:
        print(f"  ✓  WITHIN FREE TIER")
        row("Monthly cost",  "$0.00")
        row("Annual cost",   "$0.00")
    else:
        print(f"  ⚠  EXCEEDS FREE TIER")
        row("Billable tiles / month", f"{arc_t['billable_tiles_month']:,.2f}")
        row("Rate",                    arc_t['rate'])
        row("Monthly cost",            fmt_usd(arc_t['monthly_cost_usd']))
        row("Annual cost",             fmt_usd(arc_t['annual_cost_usd']))

    # ── Summary ───────────────────────────────────────────────────────────────
    header("COST SUMMARY  (using recommended session model for ArcGIS)")

    cop_annual   = cop['annual_cost_usd'] if cop['annual_cost_usd'] is not None else 0.0
    arc_annual   = arc_s['annual_cost_usd']
    total_annual = cop_annual + arc_annual

    print()
    print(f"  {'Layer':<40} {'Annual cost':>14}")
    line()
    print(f"  {'Layer 1+2  ArcGIS basemap (session model)':<40} {fmt_usd(arc_annual):>14}")
    print(f"  {'Layer 3    Copernicus NDVI (Sentinel Hub)':<40} ", end="")
    if cop['annual_cost_usd'] is None:
        print(f"{'Contact CREODIAS':>14}")
    else:
        print(f"{fmt_usd(cop_annual):>14}")
    print(f"  {'Layer 4    Field polygon (open source)':<40} {'$0.00  (free)':>14}")
    line()
    print(f"  {'TOTAL  (per year)':<40} {fmt_usd(total_annual):>14}")
    line()
    print(f"  {'TOTAL  (per month)':<40} {fmt_usd(total_annual / 12):>14}")
    print(f"  {'COST PER USER  (per year)':<40} {fmt_usd(total_annual / users) if users > 0 else '$0.00':>14}")

    # ── Free tier status ───────────────────────────────────────────────────────
    print()
    line()
    print("  FREE TIER STATUS")
    line()

    cop_status  = "✓ WITHIN FREE TIER" if cop['within_free_tier']   else "⚠ EXCEEDS FREE TIER"
    arc_status  = "✓ WITHIN FREE TIER" if arc_s['within_free_tier'] else "⚠ EXCEEDS FREE TIER"
    tile_status = "✓ WITHIN FREE TIER" if arc_t['within_free_tier'] else "⚠ EXCEEDS FREE TIER"

    row("Copernicus   (10,000 PU/month free)", cop_status)
    row("ArcGIS       (1,000 sessions/month free — session model)", arc_status)
    row("ArcGIS       (2,000,000 tiles/month free — tile model)", tile_status)

    # ── When costs kick in ────────────────────────────────────────────────────
    if cop['within_free_tier'] and arc_s['within_free_tier']:
        print()
        line()
        print("  SCALE THRESHOLDS  (at same acres/scan pattern, when costs begin)")
        line()
        pu_per_user_month    = cop['total_pu_month'] / users if users > 0 else 0
        sess_per_user_month  = arc_s['total_sessions_month'] / users if users > 0 else 0

        if pu_per_user_month > 0:
            cop_breakeven  = math.floor(COPERNICUS_FREE_TIER_PU_MONTHLY / pu_per_user_month)
        else:
            cop_breakeven  = 999_999

        if sess_per_user_month > 0:
            arc_breakeven  = math.floor(ARCGIS_SESSION_FREE_TIER_MONTHLY / sess_per_user_month)
        else:
            arc_breakeven  = 999_999

        row("Copernicus costs begin above",
            f"~{cop_breakeven:,} users  ({acres:,.0f} ac, {scans_per_year} scans/yr)")
        row("ArcGIS sessions costs begin above",
            f"~{arc_breakeven:,} users  ({acres:,.0f} ac, {scans_per_year} scans/yr)")

    # ── Footer ─────────────────────────────────────────────────────────────────
    print()
    line("═")
    print("  Official pricing pages:")
    print("    ArcGIS  → https://location.arcgis.com/pricing/")
    print("    ArcGIS  → https://location.arcgis.com/help/billing/")
    print("    CDSE    → https://dataspace.copernicus.eu/")
    print("    CDSE PU → https://dataspace.copernicus.eu/cases/")
    print("              sentinel-hub-pu-calculator-demystifying-your-costs")
    line("═")
    print()


# ─────────────────────────────────────────────────────────────────────────────
# INPUT HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def get_int(prompt: str, min_val: int = 1) -> int:
    while True:
        try:
            val = int(input(prompt).strip())
            if val < min_val:
                print(f"  Please enter a value ≥ {min_val}.")
                continue
            return val
        except ValueError:
            print("  Please enter a whole number.")

def get_float(prompt: str, min_val: float = 0.01) -> float:
    while True:
        try:
            val = float(input(prompt).strip())
            if val < min_val:
                print(f"  Please enter a value ≥ {min_val}.")
                continue
            return val
        except ValueError:
            print("  Please enter a number (e.g. 1000 or 250.5).")


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print()
    print("=" * WIDTH)
    print("  VIZ-CROP  —  PRICING CALCULATOR".center(WIDTH))
    print("  Layers: ArcGIS basemap (1+2) + Copernicus NDVI (3)".center(WIDTH))
    print("=" * WIDTH)
    print()
    print("  Enter your usage parameters below.")
    print("  Press Ctrl+C at any time to exit.")
    print()

    try:
        users          = get_int(  "  Number of users            : ", min_val=1)
        acres          = get_float("  Field size per user (acres) : ", min_val=0.1)
        scans_per_year = get_int(  "  NDVI scans per user / year  : ", min_val=1)
    except KeyboardInterrupt:
        print("\n  Exited.")
        sys.exit(0)

    print_report(users, acres, scans_per_year)

    # Offer to run another calculation
    try:
        again = input("  Run another calculation? (y/n): ").strip().lower()
        if again == "y":
            main()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    # If command-line args are provided, skip interactive prompts:
    #   python viz_crop_pricing_calculator.py <users> <acres> <scans_per_year>
    #   Example: python viz_crop_pricing_calculator.py 100 1000 8
    if len(sys.argv) == 4:
        try:
            u = int(sys.argv[1])
            a = float(sys.argv[2])
            s = int(sys.argv[3])
            print_report(u, a, s)
        except (ValueError, IndexError):
            print("Usage: python viz_crop_pricing_calculator.py <users> <acres> <scans_per_year>")
            print("Example: python viz_crop_pricing_calculator.py 100 1000 8")
            sys.exit(1)
    else:
        main()