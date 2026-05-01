<?php
// ─────────────────────────────────────────────────────────────────────────────
// AcadHost phpMyAdmin Single Sign-On Handler
//
// Resolves { token, databaseId } in this order:
//   1. URL query params  (primary — set by launch.php)
//   2. PHP session       (fallback — when PMA itself calls signon.php directly)
// Then verifies with the backend and writes the PMA signon session.
// ─────────────────────────────────────────────────────────────────────────────

// 1) Resolve token + databaseId.
$token      = $_GET['token']      ?? '';
$databaseId = $_GET['databaseId'] ?? '';

session_name('acadhost');
session_start();

// Fall back to session values if not on the URL.
if (!$token || !$databaseId) {
    $token      = $_SESSION['acadhost_token']      ?? '';
    $databaseId = $_SESSION['acadhost_databaseId'] ?? '';
}

// If we got them on the URL, also store in session so subsequent PMA
// internal calls to signon.php can reuse them.
if (!empty($_GET['token']))      $_SESSION['acadhost_token']      = $_GET['token'];
if (!empty($_GET['databaseId'])) $_SESSION['acadhost_databaseId'] = (int)$_GET['databaseId'];

$lastDbId = $_SESSION['acadhost_last_db_id'] ?? null;
session_write_close();

if (!$token || !$databaseId) {
    die('Missing token or databaseId. Please reopen from the AcadHost dashboard.');
}

// 2) Open PMA signon session. If already signed in to the SAME db, reuse.
session_name('SignonSession');
session_start();

if (
    !empty($_SESSION['PMA_single_signon_user']) &&
    $lastDbId !== null &&
    (int)$lastDbId === (int)$databaseId
) {
    session_write_close();
    header('Location: /index.php');
    exit;
}

// Different DB (or first time) — clear PMA session before writing new creds.
$_SESSION = [];
session_write_close();

// 3) Verify token + ownership with the AcadHost backend.
$payload = json_encode(['token' => $token, 'databaseId' => (int)$databaseId]);

$ch = curl_init('http://host.docker.internal:3000/api/auth/phpmyadmin/verify');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
$response = curl_exec($ch);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($curlErr) {
    die('Backend unreachable: ' . htmlspecialchars($curlErr));
}

$data = json_decode($response, true);
if (!$data || empty($data['valid'])) {
    die('Authentication failed: ' . htmlspecialchars($response ?? ''));
}

// 4) Write the new PMA signon session.
session_name('SignonSession');
session_start();
$_SESSION['PMA_single_signon_user']     = $data['dbUser'];
$_SESSION['PMA_single_signon_password'] = $data['dbPassword'];
$_SESSION['PMA_single_signon_host']     = 'host.docker.internal';
$_SESSION['PMA_single_signon_port']     = '3306';
$_SESSION['PMA_single_signon_only_db']  = $data['dbName'];
session_write_close();

// 5) Remember which DB we're now signed in to.
session_name('acadhost');
session_start();
$_SESSION['acadhost_last_db_id'] = (int)$databaseId;
session_write_close();

// 6) Redirect into PMA with the target DB selected.
header('Location: /index.php?db=' . urlencode($data['dbName']));
exit;