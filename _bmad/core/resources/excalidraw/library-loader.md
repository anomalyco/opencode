# External Library Loader

**Status:** Placeholder for future implementation

## Purpose

Load external .excalidrawlib files from <https://libraries.excalidraw.com> or custom sources.

## Planned Capabilities

- Load libraries by URL
- Load libraries from local files
- Merge multiple libraries
- Filter library components
- Cache loaded libraries

## API Reference

Will document how to use:

- `importLibrary(url)` - Load library from URL
- `loadSceneOrLibraryFromBlob()` - Load from file
- `mergeLibraryItems()` - Combine libraries

## Usage Example

```yaml
# Future workflow.yaml structure
libraries:
  - url: 'https://libraries.excalidraw.com/libraries/...'
    filter: ['aws', 'cloud']
  - path: '{project-root}/_data/custom-library.excalidrawlib'
```

## Implementation Notes

This will be developed when agents need to leverage the extensive library ecosystem available at <https://libraries.excalidraw.com>.

Hundreds of pre-built component libraries exist for:

- AWS/Cloud icons
- UI/UX components
- Business diagrams
- Mind map shapes
- Floor plans
- And much more...

## User Configuration

Future: Users will be able to configure favorite libraries in their BMAD config for automatic loading.
