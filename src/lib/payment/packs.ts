export const MIN_PURCHASE_DOLLARS = 5;
export const CREDITS_PER_DOLLAR = 5; // $20 => 100 credits

export function dollarsToCredits(dollars: number): number {
  return Math.floor(dollars * CREDITS_PER_DOLLAR);
}

export function dollarsToMinorUnits(dollars: number): number {
  return Math.round(dollars * 100);
}
