# Modules

Runtime modules are the migration path from bootstrap-heavy wiring to scalable subsystem composition.

## Concepts

- RuntimeModule: lifecycle unit with id, phase, optional dependencies, and start/cleanup.
- ModuleHost: orchestrates module startup order and teardown.
- Module phases: core -> simulation -> rendering -> ui -> workers.

## Pattern

Use one module per major concern:

- simulation world lifecycle
- scene renderer lifecycle
- minimap lifecycle
- inventory UI lifecycle
- worker bridges

Modules should be small and explicit about dependencies.
