# Tavily Configuration Admin UI

## Overview

This admin UI provides complete control over Tavily search parameters for each research phase. Adjust search behavior, optimize costs, and manage source quality without touching code.

## Features

- **9 Configurable Parameters**: Control every aspect of Tavily search
- **Per-Phase Settings**: Different configuration for Phase 1, 2, and 3
- **Domain Management**: Whitelist trusted sources, blacklist spam
- **Visual Controls**: Intuitive sliders, dropdowns, and inputs
- **Best Practices Guide**: Built-in recommendations
- **Real-Time Updates**: Changes apply immediately to new sessions

## Access

**URL**: `/admin/tavily-config`

**From Admin Panel**: Click "⚙️ Tavily Search Parameters"

## Parameters

### 1. Search Depth
- **basic**: Fast, lightweight searches
- **advanced**: Deeper, more relevant results

### 2. Topic
- **general**: Broad web search
- **news**: Current events
- **finance**: Market data

### 3. Time Range
- Filter by content publish date (day/week/month/year)

### 4. Max Results
- 5-100 sources (slider control)

### 5. Include Raw Content
- **false**: Snippets only
- **markdown**: Full content, formatted
- **text**: Full content, plain

### 6. Include Images
- Enable/disable image results

### 7. Include AI Answer
- **false**: No summary
- **basic**: Quick summary
- **advanced**: Detailed analysis

### 8. Include Domains (Whitelist)
- Only search these trusted sources

### 9. Exclude Domains (Blacklist)
- Block spam/low-quality sources

## Usage

1. Select a phase tab (Phase 1, 2, or 3)
2. Adjust parameters using the controls
3. Add/remove domains as needed
4. Click "Save Configuration"
5. Test with a new research session

## Configuration Presets

### Quick Lookup
```
search_depth: basic
max_results: 10
include_raw_content: false
```

### Deep Research
```
search_depth: advanced
max_results: 100
include_raw_content: markdown
```

### News Focus
```
topic: news
time_range: w
search_depth: advanced
```

## Technical Details

### Data Storage
Configurations are stored in the `admin_config` table:
- `phase1_tavily_params`
- `phase2_tavily_params`
- `phase3_tavily_params`

### API Integration
Phase routes automatically load and apply the saved configuration for each research request.

### Fallback
If no configuration exists, the system uses sensible defaults:
```json
{
  "search_depth": "advanced",
  "topic": "general",
  "max_results": 50,
  "include_raw_content": true,
  "include_answer": true,
  "include_images": false,
  "include_domains": [],
  "exclude_domains": []
}
```

## Documentation

- **Quick Start**: `TAVILY_CONFIG_START_HERE.md`
- **Complete Guide**: `TAVILY_CONFIG_GUIDE.md`
- **Quick Reference**: `TAVILY_QUICK_REFERENCE.md`
- **Implementation**: `TAVILY_CONFIG_IMPLEMENTATION.md`
- **Architecture**: `TAVILY_CONFIG_FLOW.md`

## Support

For questions or issues, consult the documentation files in the project root.
