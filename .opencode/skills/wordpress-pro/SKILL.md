---
name: wordpress-pro
description: Develops custom WordPress themes and plugins, creates and registers Gutenberg blocks and block patterns, configures WooCommerce stores, implements WordPress REST API endpoints, applies security hardening (nonces, sanitization, escaping, capability checks), and optimizes performance through caching and query tuning. Use when building WordPress themes, writing plugins, customizing Gutenberg blocks, extending WooCommerce, working with ACF, using the WordPress REST API, applying hooks and filters, or improving WordPress performance and security.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: platform
  triggers: WordPress, WooCommerce, Gutenberg, WordPress theme, WordPress plugin, custom blocks, ACF, WordPress REST API, hooks, filters, WordPress performance, WordPress security
  role: expert
  scope: implementation
  output-format: code
  related-skills: php-pro, laravel-specialist, fullstack-guardian, security-reviewer
---

# WordPress Pro

Expert WordPress developer specializing in custom themes, plugins, Gutenberg blocks, WooCommerce, and WordPress performance optimization.

## Core Workflow

1. **Analyze requirements** — Understand WordPress context, existing setup, and goals.
2. **Design architecture** — Plan theme/plugin structure, hooks, and data flow.
3. **Implement** — Build using WordPress coding standards and security best practices.
4. **Validate** — Run `phpcs --standard=WordPress` to catch WPCS violations; verify nonce handling and capability checks manually.
5. **Optimize** — Apply transient/object caching, query optimization, and asset enqueuing.
6. **Test & secure** — Confirm sanitization/escaping on all I/O, test across target WordPress versions, and run a security audit checklist.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Theme Development | `references/theme-development.md` | Templates, hierarchy, child themes, FSE |
| Plugin Architecture | `references/plugin-architecture.md` | Structure, activation, settings API, updates |
| Gutenberg Blocks | `references/gutenberg-blocks.md` | Block dev, patterns, FSE, dynamic blocks |
| Hooks & Filters | `references/hooks-filters.md` | Actions, filters, custom hooks, priorities |
| Performance & Security | `references/performance-security.md` | Caching, optimization, hardening, backups |

## Key Implementation Patterns

### Nonce Verification (form submissions)
```php
// Output nonce field in form
wp_nonce_field( 'my_action', 'my_nonce' );

// Verify on submission — bail early if invalid
if ( ! isset( $_POST['my_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['my_nonce'] ) ), 'my_action' ) ) {
    wp_die( esc_html__( 'Security check failed.', 'my-textdomain' ) );
}
```

### Sanitization & Escaping
```php
// Sanitize input (store)
$title   = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
$content = wp_kses_post( wp_unslash( $_POST['content'] ?? '' ) );
$url     = esc_url_raw( wp_unslash( $_POST['url'] ?? '' ) );

// Escape output (display)
echo esc_html( $title );
echo wp_kses_post( $content );
echo '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Link', 'my-textdomain' ) . '</a>';
```

### Enqueuing Scripts & Styles
```php
add_action( 'wp_enqueue_scripts', 'my_theme_assets' );
function my_theme_assets(): void {
    wp_enqueue_style(
        'my-theme-style',
        get_stylesheet_uri(),
        [],
        wp_get_theme()->get( 'Version' )
    );
    wp_enqueue_script(
        'my-theme-script',
        get_template_directory_uri() . '/assets/js/main.js',
        [ 'jquery' ],
        '1.0.0',
        true // load in footer
    );
    // Pass server data to JS safely
    wp_localize_script( 'my-theme-script', 'MyTheme', [
        'ajaxUrl' => admin_url( 'admin-ajax.php' ),
        'nonce'   => wp_create_nonce( 'my_ajax_nonce' ),
    ] );
}
```

### Prepared Database Queries
```php
global $wpdb;
$results = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}my_table WHERE user_id = %d AND status = %s",
        absint( $user_id ),
        sanitize_text_field( $status )
    )
);
```

### Capability Checks
```php
// Always check capabilities before sensitive operations
if ( ! current_user_can( 'manage_options' ) ) {
    wp_die( esc_html__( 'You do not have permission to do this.', 'my-textdomain' ) );
}
```

## Constraints

### MUST DO
- Follow WordPress Coding Standards (WPCS); validate with `phpcs --standard=WordPress`
- Use nonces for all form submissions and AJAX requests
- Sanitize all user inputs with appropriate functions (`sanitize_text_field`, `wp_kses_post`, etc.)
- Escape all outputs (`esc_html`, `esc_url`, `esc_attr`, `wp_kses_post`)
- Use prepared statements for all database queries (`$wpdb->prepare`)
- Implement proper capability checks before privileged operations
- Enqueue scripts/styles via `wp_enqueue_scripts` / `admin_enqueue_scripts` hooks
- Use WordPress hooks instead of modifying core
- Write translatable strings with text domains (`__()`, `esc_html__()`, etc.)
- Test across target WordPress versions

### MUST NOT DO
- Modify WordPress core files
- Use PHP short tags or deprecated functions
- Trust user input without sanitization
- Output data without escaping
- Hardcode database table names (use `$wpdb->prefix`)
- Skip capability checks in admin functions
- Ignore SQL injection vectors
- Bundle unnecessary libraries when WordPress APIs suffice
- Allow unsafe file upload handling
- Skip internationalization (i18n)

## Output Templates

When implementing WordPress features, provide:
1. Main plugin/theme file with proper headers
2. Relevant template files or block code
3. Functions with proper WordPress hooks
4. Security implementations (nonces, sanitization, escaping)
5. Brief explanation of WordPress-specific patterns used

## Knowledge Reference

WordPress 6.4+, PHP 8.1+, Gutenberg, WooCommerce, ACF, REST API, WP-CLI, block development, theme customizer, widget API, shortcode API, transients, object caching, query optimization, security hardening, WPCS

[Documentation](https://jeffallan.github.io/claude-skills/skills/platform/wordpress-pro/)
