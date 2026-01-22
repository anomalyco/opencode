# Example: Linear Algebra Fundamentals
Source: [Example Textbook for Testing]

## Definition 1.1 (Vector Space)
A vector space V over a field F is a set equipped with two operations:
- Addition: V × V → V
- Scalar multiplication: F × V → V
satisfying the eight vector space axioms.

## Theorem 2.1 (Dimension Theorem)
If V is a finite-dimensional vector space, then any two bases of V have the same number of elements. This number is called the dimension of V, denoted dim(V).

## Theorem 3.1 (Eigenvalue Existence)
Every linear operator on a finite-dimensional complex vector space has at least one eigenvalue.

## Proof of Theorem 3.1
Let T: V → V be a linear operator on an n-dimensional complex vector space.
Consider the characteristic polynomial p(λ) = det(T - λI).
By the Fundamental Theorem of Algebra, p(λ) has at least one root in C.
This root is an eigenvalue of T.
QED.

## Theorem 4.1 (Spectral Theorem)
A linear operator T on a finite-dimensional inner product space V is self-adjoint if and only if V has an orthonormal basis consisting of eigenvectors of T.
