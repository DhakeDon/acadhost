# Section 1 — System Overview & Tech Stack

## 1.1 Problem Statement

Academic institutions currently lack centralized hosting infrastructure, leaving student-developed applications confined to local environments. There is no standardized deployment workflow, no centralized monitoring of deployed projects, and no enforced resource limits for CPU, RAM, or storage. The absence of structured multi-tenant isolation and the reliance on third-party cloud platforms further limit institutional control over how student applications are hosted and governed.

## 1.2 Proposed System Overview

AcadHost is a self-hosted, container-based deployment platform designed for academic institutions. It enables centralized hosting of student web applications within an institution-controlled environment using Docker-based containerization, providing per-project isolation, resource quota enforcement, and automated build-and-deploy workflows. Applications are routed via a reverse proxy for subdomain access, and each project can be provisioned with an isolated MySQL database using restricted credentials. The entire system operates on a single institutional virtual machine, eliminating dependency on external cloud providers.

## 1.3 Platform Domain & Networking

| Parameter | Value |
|---|---|
| Platform domain | `*.acadhost.com` |
| Wildcard DNS provider | Cloudflare |
| VM network type | Private IP (no public IP required) |
| Internet exposure method | Cloudflare Tunnel (`cloudflared`) installed on the VM |
| Traffic flow | `*.acadhost.com` → Cloudflare edge → `cloudflared` tunnel → Nginx on VM |
| SSL termination | At the Cloudflare edge |
| Nginx protocol | Plain HTTP only (receives traffic internally from the tunnel) |
| SSL certificates on VM | None — no `certbot`, no Let's Encrypt, no port 443 configuration on the VM |
| Firewall | UFW on the VM blocks all inbound traffic from the public internet; the only ingress path is through the Cloudflare Tunnel |

## 1.4 VM Specifications

| Environment | CPU Cores | RAM | Storage |
|---|---|---|---|
| Development | 12 | 16 GB | 60 GB |
| Production | To be defined | To be defined | To be defined |

## 1.5 Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express.js |
| Student Dashboard (Frontend) | React.js |
| Admin Dashboard (Frontend) | React.js |
| Containerization | Docker with multi-stage builds |
| Reverse Proxy | Nginx |
| Public Internet Exposure | Cloudflare Tunnel (`cloudflared`) |
| Database | Host-based MySQL server |
| Database Management UI | phpMyAdmin |
| Host OS (Production) | Ubuntu Linux |
| Firewall (Production) | UFW (port-level rules) |
| Email | Gmail SMTP (`smtp.gmail.com:587`) using an App Password |

## 1.6 Development Environment

| Parameter | Value |
|---|---|
| Development OS | Windows |
| Docker backend | Docker Desktop with WSL2 backend |
| MySQL (development) | Runs inside a Docker container |
| Nginx (development) | Runs inside a Docker container |
| MySQL (production) | Runs natively on the Ubuntu VM |
| Nginx (production) | Runs natively on the Ubuntu VM |
| Local orchestration | Single `docker-compose.yml` at the repo root spins up MySQL, Nginx, phpMyAdmin, and the backend together |
| Production orchestration | `docker-compose.yml` is NOT used; each service runs natively or as a managed Docker container directly |
| File system paths | All paths in the backend are configurable via environment variables — no paths are hardcoded; this ensures the same codebase runs on both Windows development and Linux production without any code changes |
| Cloudflare Tunnel (development) | Not used during local development |
| Local access (development) | Developers access the platform directly via `localhost` or `127.0.0.1` with ports mapped explicitly |
| Subdomain routing (development) | Simulated via local `/etc/hosts` entries or skipped entirely during unit development |

## 1.7 Architecture Parameters

| Parameter | Value |
|---|---|
| Default CPU per student | 2 cores |
| Default RAM per student | 1 GB |
| Default storage per student | 2.5 GB |
| Max projects per student | 4 |
| Max databases per student | 4 |
| Max concurrent builds | 4 |
| Container port pool | 10,000 – 20,000 |
| Build timeout | 10 minutes (configurable via `BUILD_TIMEOUT_MINUTES` env var, default 10) |
| Build log retention | 7 days |
| Runtime log retention | Ephemeral |
| Storage warning threshold | 80% of quota |
| Max ZIP upload size | 200 MB (enforced before extraction) |
| Access token expiry | 15 minutes |
| Refresh token expiry | 7 days |
| Invite link expiry | 2 hours |
| Password reset token expiry | 1 hour |
| Email daily limit | 500 emails (Gmail SMTP) |

## 1.8 Container Restart Policy

All containers are started with `--restart unless-stopped`. Crashes are automatically recovered by Docker with exponential backoff on repeated failures. Intentional stops from the admin or student dashboard are respected and the container remains stopped.

## 1.9 Image Storage

Docker images are stored in `/var/lib/docker/` at the host level and are not attributed to student quotas. The old image for a project is deleted immediately after every successful rebuild to prevent unbounded disk growth. Student quotas track only the contents of their source directories and runtime-generated files.

## 1.10 File Path Configuration

All file system paths used by the backend are defined via environment variables. The base projects directory is controlled by `PROJECTS_BASE_DIR`.

| Environment | `PROJECTS_BASE_DIR` Default |
|---|---|
| Production | `/home/acadhost/projects` |
| Windows Development | `C:/acadhost/projects` |

No paths are hardcoded anywhere in the application.

## 1.11 Reserved Subdomains

The following subdomains are reserved and cannot be claimed by students:

| Reserved Subdomain |
|---|
| `admin` |
| `api` |
| `www` |
| `mail` |
| `ftp` |
| `smtp` |
| `static` |
| `app` |
| `phpmyadmin` |

## 1.12 Supported Runtimes & Project Types

### Supported Runtimes

| Runtime | Available Versions | Default Version |
|---|---|---|
| Node.js | 18, 20, 22, 23 | 20 |
| Python | 3.10, 3.11, 3.12, 3.13 | 3.11 |

### Project Type Auto-Detection

| File Present | Detected Runtime |
|---|---|
| `package.json` | Node.js |
| `requirements.txt` | Python |

### Supported Project Types

| Project Type | Description | Deployment Strategy |
|---|---|---|
| Frontend only | Static site | Built and deployed as a container with internal Nginx serving static files; host Nginx reverse-proxies to the container's assigned port exactly like any other project container |
| Backend only | Server application | Built and run as a Docker container |
| Frontend + Backend | Combined application | Frontend is built first, its output is placed into the backend directory, and the combined application is deployed as a single container |

### Source Upload Methods

| Method | Details |
|---|---|
| Git repository URL | Supports GitHub webhook integration — on push: pull new code, rebuild Docker image from scratch, stop and remove old container, spin up fresh container with all same configuration (port assignment, subdomain routing, CPU and RAM limits, database credentials) re-injected automatically; subdomain experiences only a brief switchover downtime; no Nginx reconfiguration required |
| ZIP file upload | Maximum 200 MB, enforced before extraction |

For combined (Frontend + Backend) projects, the student provides two separate sources — either two Git repositories or two ZIP files, one for each layer. Mixing source types (one Git + one ZIP) is not allowed.

## 1.13 Admin Account

The admin account is a single fixed account created via a seed script on first deployment. The admin email is configured through an environment variable. There is no self-registration for admin accounts. The admin must change their password on first login.