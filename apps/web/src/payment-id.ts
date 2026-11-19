/** A new payment's ID (G2b), made once per form, so pressing Record again after a dropped connection records it once. */
export const newPaymentId = (): string => crypto.randomUUID().replaceAll("-", "");
