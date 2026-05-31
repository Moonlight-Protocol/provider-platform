// Helper retired in the logging convention migration. Throw directly at call
// sites — the catch in the calling handler/factory logs the error via
// log.error(err, msg).
