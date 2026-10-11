SELECT id, title, status
FROM reviews
WHERE status = 'pending'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50;
