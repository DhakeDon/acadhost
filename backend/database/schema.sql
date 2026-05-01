USE acadhost;

-- ============================================================
-- Table 1: users
-- ============================================================
CREATE TABLE `users` (
                         `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                         `email` VARCHAR(255) NOT NULL,
                         `password_hash` VARCHAR(255) NULL DEFAULT NULL,
                         `name` VARCHAR(255) NULL DEFAULT NULL,
                         `role` ENUM('admin', 'student') NOT NULL DEFAULT 'student',
                         `batch_year` SMALLINT UNSIGNED NULL DEFAULT NULL,
                         `dark_mode` TINYINT(1) NOT NULL DEFAULT 0,
                         `cpu_quota` DECIMAL(5,2) NOT NULL DEFAULT 2.00,
                         `ram_quota_mb` INT UNSIGNED NOT NULL DEFAULT 1024,
                         `storage_quota_mb` INT UNSIGNED NOT NULL DEFAULT 2560,
                         `max_projects` INT UNSIGNED NOT NULL DEFAULT 4,
                         `max_databases` INT UNSIGNED NOT NULL DEFAULT 4,
                         `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
                         `status` ENUM('invited', 'active', 'removed') NOT NULL DEFAULT 'invited',
                         `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                         `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                         PRIMARY KEY (`id`),
                         UNIQUE KEY `uq_users_email` (`email`),
                         KEY `idx_users_role` (`role`),
                         KEY `idx_users_batch_year` (`batch_year`),
                         KEY `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table 2: databases
-- ============================================================
CREATE TABLE `databases` (
                             `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                             `user_id` INT UNSIGNED NOT NULL,
                             `db_name` VARCHAR(64) NOT NULL,
                             `db_user` VARCHAR(32) NOT NULL,
                             `db_password_encrypted` VARCHAR(512) NOT NULL,
                             `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                             PRIMARY KEY (`id`),
                             UNIQUE KEY `uq_databases_db_user` (`db_user`),
                             UNIQUE KEY `uq_databases_user_db_name` (`user_id`, `db_name`),
                             KEY `idx_databases_user_id` (`user_id`),
                             CONSTRAINT `fk_databases_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table 3: projects
-- ============================================================
CREATE TABLE `projects` (
                            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                            `user_id` INT UNSIGNED NOT NULL,
                            `title` VARCHAR(255) NOT NULL,
                            `subdomain` VARCHAR(63) NOT NULL,
                            `project_type` ENUM('frontend', 'backend', 'combined') NOT NULL,
                            `runtime` ENUM('node', 'python') NULL DEFAULT NULL,
                            `runtime_version` VARCHAR(10) NULL DEFAULT NULL,
                            `source_type` ENUM('git', 'zip') NOT NULL,
                            `git_url` VARCHAR(2048) NULL DEFAULT NULL,
                            `git_url_backend` VARCHAR(2048) NULL DEFAULT NULL,
                            `webhook_secret` VARCHAR(255) NULL DEFAULT NULL,
                            `webhook_secret_backend` VARCHAR(255) NULL DEFAULT NULL,
                            `container_id` VARCHAR(64) NULL DEFAULT NULL,
                            `container_port` INT UNSIGNED NULL DEFAULT NULL,
                            `cpu_limit` DECIMAL(5,2) NOT NULL,
                            `ram_limit_mb` INT UNSIGNED NOT NULL,
                            `database_id` INT UNSIGNED NULL DEFAULT NULL,
                            `status` ENUM('building', 'running', 'stopped', 'failed', 'deleted') NOT NULL DEFAULT 'building',
                            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                            PRIMARY KEY (`id`),
                            UNIQUE KEY `uq_projects_subdomain` (`subdomain`),
                            UNIQUE KEY `uq_projects_container_port` (`container_port`),
                            KEY `idx_projects_user_id` (`user_id`),
                            KEY `idx_projects_status` (`status`),
                            KEY `idx_projects_database_id` (`database_id`),
                            CONSTRAINT `fk_projects_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
                            CONSTRAINT `fk_projects_database_id` FOREIGN KEY (`database_id`) REFERENCES `databases` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table 4: resource_requests
-- ============================================================
CREATE TABLE `resource_requests` (
                                     `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                                     `user_id` INT UNSIGNED NOT NULL,
                                     `resource_type` ENUM('cpu', 'ram', 'storage', 'projects', 'databases') NOT NULL,
                                     `requested_value` VARCHAR(50) NOT NULL,
                                     `description` TEXT NOT NULL,
                                     `status` ENUM('pending', 'approved', 'denied') NOT NULL DEFAULT 'pending',
                                     `admin_notes` TEXT NULL DEFAULT NULL,
                                     `reviewed_at` TIMESTAMP NULL DEFAULT NULL,
                                     `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                     `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                                     PRIMARY KEY (`id`),
                                     KEY `idx_resource_requests_user_id` (`user_id`),
                                     KEY `idx_resource_requests_status` (`status`),
                                     CONSTRAINT `fk_resource_requests_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table 5: refresh_tokens
-- ============================================================
CREATE TABLE `refresh_tokens` (
                                  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                                  `user_id` INT UNSIGNED NOT NULL,
                                  `token_hash` VARCHAR(255) NOT NULL,
                                  `expires_at` TIMESTAMP NOT NULL,
                                  `revoked` TINYINT(1) NOT NULL DEFAULT 0,
                                  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                  PRIMARY KEY (`id`),
                                  UNIQUE KEY `uq_refresh_tokens_token_hash` (`token_hash`),
                                  KEY `idx_refresh_tokens_user_id` (`user_id`),
                                  KEY `idx_refresh_tokens_expires_at` (`expires_at`),
                                  CONSTRAINT `fk_refresh_tokens_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table 6: invite_tokens
-- ============================================================
CREATE TABLE `invite_tokens` (
                                 `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                                 `email` VARCHAR(255) NOT NULL,
                                 `token_hash` VARCHAR(255) NOT NULL,
                                 `batch_year` SMALLINT UNSIGNED NULL DEFAULT NULL,
                                 `expires_at` TIMESTAMP NOT NULL,
                                 `used` TINYINT(1) NOT NULL DEFAULT 0,
                                 `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                 PRIMARY KEY (`id`),
                                 UNIQUE KEY `uq_invite_tokens_token_hash` (`token_hash`),
                                 KEY `idx_invite_tokens_email` (`email`),
                                 KEY `idx_invite_tokens_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table 7: builds
-- ============================================================
CREATE TABLE `builds` (
                          `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                          `project_id` INT UNSIGNED NOT NULL,
                          `status` ENUM('building', 'success', 'failed', 'timeout') NOT NULL DEFAULT 'building',
                          `log_file_path` VARCHAR(512) NOT NULL,
                          `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          `completed_at` TIMESTAMP NULL DEFAULT NULL,
                          PRIMARY KEY (`id`),
                          KEY `idx_builds_project_id` (`project_id`),
                          KEY `idx_builds_started_at` (`started_at`),
                          CONSTRAINT `fk_builds_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Table 8: password_reset_tokens
-- ============================================================
CREATE TABLE `password_reset_tokens` (
                                         `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
                                         `user_id` INT UNSIGNED NOT NULL,
                                         `token_hash` VARCHAR(255) NOT NULL,
                                         `expires_at` TIMESTAMP NOT NULL,
                                         `used` TINYINT(1) NOT NULL DEFAULT 0,
                                         `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                         PRIMARY KEY (`id`),
                                         UNIQUE KEY `uq_password_reset_tokens_token_hash` (`token_hash`),
                                         KEY `idx_password_reset_tokens_user_id` (`user_id`),
                                         KEY `idx_password_reset_tokens_expires_at` (`expires_at`),
                                         CONSTRAINT `fk_password_reset_tokens_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


ALTER TABLE `users`
    MODIFY COLUMN `status`
    ENUM('invited', 'active', 'suspended', 'removed')
    NOT NULL DEFAULT 'invited';
