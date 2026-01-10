# Project Plan: Todo API

## Overview

Building a REST API for todo list management with user authentication.

## Epics

### Epic: api
- **Path:** ./api
- **Description:** Backend REST API server

### Epic: shared
- **Path:** ./shared
- **Description:** Shared types and utilities

## Definition of Done

- All endpoints implemented and tested
- Authentication working
- API documentation complete
- All tests passing

## Task Backlog

### Ticket: T001 Project Setup
- **Priority:** P0
- **Status:** Done
- **Epic:** api
- **Owner:** agent-1
- **Acceptance Criteria:**
  - package.json created with dependencies
  - TypeScript configured
  - ESLint configured
  - Basic Express server starts
- **Validation Steps:**
  - `cd api && npm install` completes without errors
  - `cd api && npm run typecheck` passes
  - `cd api && npm run dev` starts server on port 3000
- **Notes:** Completed in initial setup

### Ticket: T002 User Model
- **Priority:** P0
- **Status:** In Progress
- **Epic:** shared
- **Owner:** agent-2
- **Dependencies:** T001
- **Acceptance Criteria:**
  - User type defined with id, email, name, passwordHash
  - Validation functions for user fields
  - Export from shared package
- **Validation Steps:**
  - `cd shared && npm run typecheck` passes
  - `cd shared && npm test` passes
- **Notes:**

### Ticket: T003 Todo Model
- **Priority:** P0
- **Status:** Todo
- **Epic:** shared
- **Owner:** Unassigned
- **Dependencies:** T001
- **Acceptance Criteria:**
  - Todo type defined with id, userId, title, completed, createdAt
  - Validation functions for todo fields
- **Validation Steps:**
  - `cd shared && npm run typecheck` passes
  - `cd shared && npm test` passes
- **Notes:**

### Ticket: T004 Database Setup
- **Priority:** P0
- **Status:** Todo
- **Epic:** api
- **Owner:** Unassigned
- **Dependencies:** T002, T003
- **Acceptance Criteria:**
  - SQLite database configured
  - User and Todo tables created
  - Database migrations working
- **Validation Steps:**
  - `cd api && npm run db:migrate` creates tables
  - Tables exist in database file
- **Notes:**

### Ticket: T005 Auth Endpoints
- **Priority:** P0
- **Status:** Todo
- **Epic:** api
- **Owner:** Unassigned
- **Dependencies:** T004
- **Acceptance Criteria:**
  - POST /auth/register creates user
  - POST /auth/login returns JWT token
  - Passwords hashed with bcrypt
  - Input validation on all endpoints
- **Validation Steps:**
  - `cd api && npm test -- auth.test.ts` passes
- **Notes:**

### Ticket: T006 Todo CRUD Endpoints
- **Priority:** P0
- **Status:** Todo
- **Epic:** api
- **Owner:** Unassigned
- **Dependencies:** T004, T005
- **Acceptance Criteria:**
  - GET /todos returns user's todos
  - POST /todos creates todo
  - PUT /todos/:id updates todo
  - DELETE /todos/:id removes todo
  - All endpoints require authentication
- **Validation Steps:**
  - `cd api && npm test -- todos.test.ts` passes
- **Notes:**

### Ticket: T007 API Documentation
- **Priority:** P1
- **Status:** Todo
- **Epic:** api
- **Owner:** Unassigned
- **Dependencies:** T005, T006
- **Acceptance Criteria:**
  - OpenAPI/Swagger spec generated
  - All endpoints documented
  - Example requests/responses included
- **Validation Steps:**
  - Swagger UI accessible at /docs
  - All endpoints listed with examples
- **Notes:**

### Ticket: T008 Error Handling
- **Priority:** P1
- **Status:** Todo
- **Epic:** api
- **Owner:** Unassigned
- **Dependencies:** T006
- **Acceptance Criteria:**
  - Global error handler middleware
  - Consistent error response format
  - Proper HTTP status codes
  - Errors logged but not leaked to client
- **Validation Steps:**
  - Invalid requests return proper error format
  - Server errors don't expose stack traces
- **Notes:**
