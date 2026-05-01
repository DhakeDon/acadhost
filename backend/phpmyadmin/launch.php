<?php
// ─────────────────────────────────────────────────────────────────────────────
// AcadHost → phpMyAdmin Launcher
//
// Receives { token, databaseId } on the URL, stores them in the acadhost PHP
// session (as backup), then forwards them to /signon.php as URL params so
// signon.php never has to depend on cookie timing.
// ─────────────────────────────────────────────────────────────────────────────

$token      = $_GET['token']      ?? '';
$databaseId = $_GET['databaseId'] ?? '';

if (!$token || !$databaseId) {
    die('Missing token or databaseId in launch URL');
}

// Start acadhost session and store as backup (also used to detect DB switches).
session_name('acadhost');
session_start();
$_SESSION['acadhost_token']      = $token;
$_SESSION['acadhost_databaseId'] = (int)$databaseId;
session_write_close();

// Nuke any stale PMA signon session so signon.php re-verifies.
session_name('SignonSession');
session_start();
$_SESSION = [];
session_destroy();

// Clear PMA client-side cookies so it doesn't remember old DB / auth.
setcookie('pma_lang',   '', time() - 3600, '/');
setcookie('pmaUser-1',  '', time() - 3600, '/');
setcookie('pmaAuth-1',  '', time() - 3600, '/');
setcookie('phpMyAdmin', '', time() - 3600, '/');

// Forward the values on the URL so signon.php doesn't rely solely on the
// PHP session cookie (which can race on first load).
$qs = http_build_query([
    'token'      => $token,
    'databaseId' => (int)$databaseId,
]);
header("Location: /signon.php?$qs");
exit;