# US Data Center Power Map

An interactive map of every US data center overlaid with power plant fuel mix, NERC grid zones, water stress data, and emerging AI campus development. Built to visualize the infrastructure dependencies of AI compute at national scale.

**Live:** [map.kevinclark.ai](https://map.kevinclark.ai)  
**Status:** Live  
**Facilities mapped:** 1,499 data centers · 10,831 power plants  
**Built with:** Claude Code  

---

## The argument

AI infrastructure is an energy policy problem.

Most conversations about AI focus on models, benchmarks, and deployment cost. The infrastructure layer — where the power comes from, how stressed the grid is, whether the water supply can sustain cooling demand — gets almost no attention until something breaks.

This map makes that layer visible. Every data center in the US, overlaid with the fuel mix powering it, the reliability risk of its grid zone, and the water stress of its county. The picture it reveals is not reassuring.

---

## What it shows

**1,499 data center facilities** — existing, under construction, and planned through 2026 — mapped against:

- **Power plant fuel mix** — Coal, Natural Gas, Nuclear, Solar, Wind, Hydro. Color-coded by fuel type so the energy profile of any region is immediately visible.
- **Emerging campuses** — Planned and under-construction facilities (2026), showing where AI compute demand is heading before it arrives.
- **NERC Grid Zones** — Reliability regions with 2024 LTRA stress assessment. High Risk, Elevated, Moderate, Low Risk overlays sourced from the WECC Long Term Reliability Assessment 2024.
- **Water Stress** — WRI Aqueduct county-level baseline water stress. Data centers are among the largest industrial water consumers in the US.
- **PPAs filter** — Toggle to show only facilities with direct power purchase agreements.

---

## Data sources

| Dataset | Source | Version |
|---|---|---|
| Data center facilities | PNRL IMK Atlas | v2026.02 |
| Power plant locations and fuel mix | EIA 860/923 | 2025 |
| Grid reliability zones | NERC LTRA | 2024 |
| Water stress | WRI Aqueduct | County-level baseline |

---

## Stack

- Astro
- React
- Mapbox GL JS
- Energy infrastructure data pipeline

Built entirely in Claude Code.

---

## Why this matters for AI strategy

The compute layer has physical constraints that no amount of model optimization eliminates. Grid capacity, fuel mix, water availability, and transmission reliability are hard limits on where AI infrastructure can scale — and how sustainably it can do so.

Understanding those constraints is part of the AI leader's job. This map is a tool for that understanding.

The pattern it reveals: the regions absorbing the most new AI campus development are not always the regions with the cleanest energy or the most reliable grids. That gap is a strategic and policy problem that will define AI infrastructure decisions for the next decade.

---

→ [kevinclark.ai](https://kevinclark.ai) — writing and projects  
→ [kc@kevinclark.ai](mailto:kc@kevinclark.ai)
