# Mid-World Logistics

**Distributed Systems R&D Sandbox**

This project serves as a practical exploration of event-driven architecture within the AWS ecosystem. It models a distributed supply chain, designed to isolate and solve specific challenges inherent to high-scale logistics: eventual consistency, idempotent processing, and service decoupling.

Unlike a standard CRUD application, the goal here is to enforce strict architectural boundaries using **Hexagonal Architecture** (Ports and Adapters). The domain logic is agnostic of the underlying AWS primitives, allowing for rigorous unit testing and clean separation of concerns.

## System Design Goals

The repository prioritizes the operational resilience and long-term maintainability of the system over simple feature delivery.

* **Infrastructure as Code:** All resources are defined via AWS CDK (TypeScript), enforcing a strict prohibition on manual console configuration to prevent configuration drift.
* **Event Sourcing:** State changes are propagated via Amazon EventBridge to maintain loose coupling between the *Transport* and *Inventory* domains.
* **Observability:** Implementation of structured logging and distributed tracing to ensure visibility into asynchronous workflows.

## Domain Context

The system borrows nomenclature from Stephen King's *The Dark Tower* series to model a fragmented supply chain. This abstraction allows for testing complex routing logic without relying on proprietary data models.

* **Cargo:** Discrete assets requiring tracking across boundaries.
* **Waystations:** Nodes in the network where inventory state is reconciled (DynamoDB).
* **The Beam:** The central event bus governing data flow between disparate services (EventBridge).
