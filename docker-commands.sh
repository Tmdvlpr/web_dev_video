#!/usr/bin/env bash

# ============================================================================
# Docker Development & Build Commands
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# Utility Functions
# ============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# ============================================================================
# Docker Compose Commands
# ============================================================================

compose_up() {
    log_info "Starting services with docker compose..."
    docker compose up -d
    log_info "Services started. Use 'docker compose logs -f' to view logs."
}

compose_down() {
    log_info "Stopping services..."
    docker compose down
    log_info "Services stopped."
}

compose_logs() {
    docker compose logs -f
}

compose_ps() {
    docker compose ps
}

# ============================================================================
# Build Commands
# ============================================================================

build_all() {
    log_info "Building all images..."
    docker compose build --no-cache
    log_info "Build complete."
}

build_backend() {
    log_info "Building backend image..."
    docker build -t corpmeet-backend:latest ./web/backend
    log_info "Backend build complete."
}

build_frontend() {
    log_info "Building frontend image..."
    docker build -t corpmeet-frontend:latest ./web/frontend
    log_info "Frontend build complete."
}

# ============================================================================
# Development Commands
# ============================================================================

dev_up() {
    log_info "Starting services in development mode..."
    docker compose up
}

dev_rebuild() {
    log_info "Rebuilding and starting services..."
    docker compose up --build
}

# ============================================================================
# Cleanup Commands
# ============================================================================

clean_containers() {
    log_info "Removing stopped containers..."
    docker container prune -f
    log_info "Containers cleaned."
}

clean_images() {
    log_info "Removing dangling images..."
    docker image prune -f
    log_info "Images cleaned."
}

clean_volumes() {
    log_warn "This will remove all unused volumes (including database data if not in use)."
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker volume prune -f
        log_info "Volumes cleaned."
    fi
}

clean_all() {
    log_warn "This will remove all stopped containers, dangling images, and unused volumes."
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker system prune -f
        log_info "System cleaned."
    fi
}

# ============================================================================
# Database Commands
# ============================================================================

db_shell() {
    log_info "Connecting to database..."
    docker compose exec db psql -U ${POSTGRES_USER:-corpmeet} -d ${POSTGRES_DB:-corpmeet}
}

db_backup() {
    BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
    log_info "Backing up database to $BACKUP_FILE..."
    docker compose exec -T db pg_dump -U ${POSTGRES_USER:-corpmeet} ${POSTGRES_DB:-corpmeet} > "$BACKUP_FILE"
    log_info "Backup complete: $BACKUP_FILE"
}

# ============================================================================
# Logs & Monitoring
# ============================================================================

logs_backend() {
    docker compose logs -f backend
}

logs_frontend() {
    docker compose logs -f frontend
}

logs_db() {
    docker compose logs -f db
}

logs_bot() {
    docker compose logs -f tg-bot
}

stats() {
    docker stats
}

# ============================================================================
# Health Checks
# ============================================================================

health_check() {
    log_info "Running health checks..."
    docker compose ps
    log_info ""
    log_info "Backend health:"
    curl -s http://localhost:8001/docs | grep -q "title" && log_info "✓ Backend is running" || log_error "✗ Backend is not responding"
    log_info ""
    log_info "Frontend health:"
    curl -s http://localhost | head -1 | grep -q "<!DOCTYPE" && log_info "✓ Frontend is running" || log_error "✗ Frontend is not responding"
}

# ============================================================================
# Main Menu
# ============================================================================

show_help() {
    cat << EOF
${GREEN}Docker Commands for CorpMeet${NC}

${YELLOW}Compose Commands:${NC}
  up              - Start services
  down            - Stop services
  logs            - View logs (all services)
  ps              - Show running services

${YELLOW}Build Commands:${NC}
  build-all       - Build all images (no cache)
  build-backend   - Build backend image
  build-frontend  - Build frontend image

${YELLOW}Development:${NC}
  dev-up          - Start services in foreground
  dev-rebuild     - Rebuild and start services

${YELLOW}Database:${NC}
  db-shell        - Open database shell
  db-backup       - Backup database

${YELLOW}Logs & Monitoring:${NC}
  logs-backend    - Backend logs
  logs-frontend   - Frontend logs
  logs-db         - Database logs
  logs-bot        - Bot logs
  stats           - Show container stats
  health-check    - Run health checks

${YELLOW}Cleanup:${NC}
  clean-containers - Remove stopped containers
  clean-images    - Remove dangling images
  clean-volumes   - Remove unused volumes
  clean-all       - Full cleanup

${YELLOW}Other:${NC}
  help            - Show this help message

EOF
}

# ============================================================================
# Main Entry Point
# ============================================================================

main() {
    case "${1:-help}" in
        up)
            compose_up
            ;;
        down)
            compose_down
            ;;
        logs)
            compose_logs
            ;;
        ps)
            compose_ps
            ;;
        build-all)
            build_all
            ;;
        build-backend)
            build_backend
            ;;
        build-frontend)
            build_frontend
            ;;
        dev-up)
            dev_up
            ;;
        dev-rebuild)
            dev_rebuild
            ;;
        db-shell)
            db_shell
            ;;
        db-backup)
            db_backup
            ;;
        logs-backend)
            logs_backend
            ;;
        logs-frontend)
            logs_frontend
            ;;
        logs-db)
            logs_db
            ;;
        logs-bot)
            logs_bot
            ;;
        stats)
            stats
            ;;
        health-check)
            health_check
            ;;
        clean-containers)
            clean_containers
            ;;
        clean-images)
            clean_images
            ;;
        clean-volumes)
            clean_volumes
            ;;
        clean-all)
            clean_all
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
