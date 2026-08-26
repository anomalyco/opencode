public class SumCalculator {

    /**
     * Adds two integers.
     * @throws IllegalArgumentException if overflow would occur
     */
    public static int add(int a, int b) {
        long result = (long) a + (long) b;
        if (result > Integer.MAX_VALUE || result < Integer.MIN_VALUE) {
            throw new IllegalArgumentException("Integer overflow: " + a + " + " + b);
        }
        return (int) result;
    }

    /**
     * Adds two longs.
     * @throws IllegalArgumentException if overflow would occur
     */
    public static long add(long a, long b) {
        java.math.BigInteger result = java.math.BigInteger.valueOf(a).add(java.math.BigInteger.valueOf(b));
        if (result.bitLength() > 63) {
            throw new IllegalArgumentException("Long overflow: " + a + " + " + b);
        }
        return result.longValue();
    }

    /**
     * Adds two doubles, handling NaN and Infinity.
     */
    public static double add(double a, double b) {
        return a + b;
    }

    /**
     * Adds two strings representing numbers. Returns empty string if either input is null/blank.
     * Handles leading zeros, negative numbers, and decimal points.
     */
    public static String add(String a, String b) {
        if (a == null || b == null || a.isBlank() || b.isBlank()) {
            return "";
        }
        java.math.BigDecimal dA = new java.math.BigDecimal(a.trim());
        java.math.BigDecimal dB = new java.math.BigDecimal(b.trim());
        return dA.add(dB).stripTrailingZeros().toPlainString();
    }

    /**
     * Adds two floating-point numbers using BigDecimal to avoid precision loss.
     */
    public static java.math.BigDecimal add(java.math.BigDecimal a, java.math.BigDecimal b) {
        if (a == null || b == null) {
            throw new IllegalArgumentException("Inputs cannot be null");
        }
        return a.add(b);
    }

    public static void main(String[] args) {
        // Basic cases
        System.out.println("add(2, 3) = " + add(2, 3));               // 5
        System.out.println("add(-1, 1) = " + add(-1, 1));              // 0
        System.out.println("add(0, 0) = " + add(0, 0));                // 0

        // Edge cases
        System.out.println("add(MAX, -1) = " + add(Integer.MAX_VALUE, -1)); // 2147483646
        System.out.println("add(MIN, 1) = " + add(Integer.MIN_VALUE, 1));   // -2147483647

        // Long addition
        System.out.println("add(long 100, 200) = " + add(100L, 200L));  // 300

        // Double addition
        System.out.println("add(1.1, 2.2) = " + add(1.1, 2.2));        // 3.3

        // String addition
        System.out.println("add(\"123\", \"456\") = " + add("123", "456")); // 579
        System.out.println("add(\"-5\", \"3\") = " + add("-5", "3"));       // -2
        System.out.println("add(\"\", \"5\") = " + add("", "5"));           // ""
        System.out.println("add(null, \"5\") = " + add(null, "5"));         // ""

        // BigDecimal
        System.out.println("add(BigDecimal) = " + add(
            new java.math.BigDecimal("0.1"),
            new java.math.BigDecimal("0.2")));  // 0.3
    }
}
