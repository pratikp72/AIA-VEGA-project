/**
 * Chart colors based on Infogram best practices
 * https://infogram.com/blog/best-colors-for-charts/
 *
 * - Categorical: distinct, vibrant, spread across color wheel
 * - Good contrast between adjacent colors
 * - Colorblind-friendly (avoid red-green adjacency)
 */
export const CHART_COLORS = [
  '#17BECF', // Teal - clear, professional (Infogram pie)
  '#FFC20A', // Yellow - optimistic, growth
  '#C9495E', // Coral red - attention, distinct (Infogram bar)
  '#056875', // Dark teal - depth, stability (Infogram bar)
  '#D46600', // Orange - creativity, enthusiasm (Infogram bar)
  '#6F42C1', // Purple - sophistication, wisdom
  '#38A86F', // Green - success, harmony (Infogram area)
  '#E37900', // Warm orange - energy (Infogram Gantt)
  '#F3B735', // Amber - soft highlight (Infogram area)
  '#8C2C0E', // Dark red - emphasis (Infogram Sankey)
];

export const getBarColor = (index) => CHART_COLORS[index % CHART_COLORS.length];
