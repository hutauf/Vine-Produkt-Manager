export const getNextProductWriteTimestamp = (
  previousTimestamp?: number | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): number => {
  const previous = typeof previousTimestamp === 'number' && Number.isFinite(previousTimestamp)
    ? Math.floor(previousTimestamp)
    : undefined;

  return Math.max(
    Math.floor(nowSeconds),
    previous === undefined ? 0 : previous + 1,
  );
};
