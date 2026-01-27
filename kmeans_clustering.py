import numpy as np
import matplotlib.pyplot as plt
from typing import List, Tuple, Optional
import random


class KMeans:
    def __init__(self, k: int, max_iterations: int = 100, tolerance: float = 1e-4):
        self.k = k
        self.max_iterations = max_iterations
        self.tolerance = tolerance
        self.centroids = None
        self.labels = None

    def initialize_centroids(self, data: np.ndarray) -> np.ndarray:
        n_samples = data.shape[0]
        random_indices = random.sample(range(n_samples), self.k)
        return data[random_indices]

    def assign_clusters(self, data: np.ndarray, centroids: np.ndarray) -> np.ndarray:
        distances = np.zeros((data.shape[0], self.k))
        for i in range(self.k):
            distances[:, i] = np.linalg.norm(data - centroids[i], axis=1)
        return np.argmin(distances, axis=1)

    def update_centroids(self, data: np.ndarray, labels: np.ndarray) -> np.ndarray:
        new_centroids = np.zeros((self.k, data.shape[1]))
        for i in range(self.k):
            cluster_data = data[labels == i]
            if len(cluster_data) > 0:
                new_centroids[i] = np.mean(cluster_data, axis=0)
            else:
                new_centroids[i] = self.centroids[i]
        return new_centroids

    def has_converged(
        self, old_centroids: np.ndarray, new_centroids: np.ndarray
    ) -> bool:
        return np.all(
            np.linalg.norm(old_centroids - new_centroids, axis=1) < self.tolerance
        )

    def fit(self, data: np.ndarray) -> "KMeans":
        self.centroids = self.initialize_centroids(data)

        for iteration in range(self.max_iterations):
            old_centroids = self.centroids.copy()

            self.labels = self.assign_clusters(data, self.centroids)
            self.centroids = self.update_centroids(data, self.labels)

            if self.has_converged(old_centroids, self.centroids):
                break

        return self

    def predict(self, data: np.ndarray) -> np.ndarray:
        if self.centroids is None:
            raise ValueError("Model not fitted yet. Call fit() first.")
        return self.assign_clusters(data, self.centroids)

    def inertia(self, data: np.ndarray) -> float:
        if self.labels is None or self.centroids is None:
            raise ValueError("Model not fitted yet. Call fit() first.")

        total_distance = 0
        for i in range(self.k):
            cluster_data = data[self.labels == i]
            if len(cluster_data) > 0:
                total_distance += np.sum(
                    np.linalg.norm(cluster_data - self.centroids[i], axis=1) ** 2
                )
        return total_distance


def generate_sample_data(
    n_samples: int = 300, n_features: int = 2, n_clusters: int = 3
) -> Tuple[np.ndarray, np.ndarray]:
    np.random.seed(42)

    centers = np.random.randn(n_clusters, n_features) * 5

    data = []
    true_labels = []

    samples_per_cluster = n_samples // n_clusters

    for i in range(n_clusters):
        cluster_data = np.random.randn(samples_per_cluster, n_features) + centers[i]
        data.append(cluster_data)
        true_labels.extend([i] * samples_per_cluster)

    return np.vstack(data), np.array(true_labels)


def plot_clusters(
    data: np.ndarray,
    labels: np.ndarray,
    centroids: Optional[np.ndarray] = None,
    title: str = "K-means Clustering",
):
    plt.figure(figsize=(10, 6))

    scatter = plt.scatter(data[:, 0], data[:, 1], c=labels, cmap="viridis", alpha=0.7)

    if centroids is not None:
        plt.scatter(
            centroids[:, 0],
            centroids[:, 1],
            c="red",
            marker="x",
            s=200,
            linewidths=3,
            label="Centroids",
        )

    plt.colorbar(scatter, label="Cluster")
    plt.xlabel("Feature 1")
    plt.ylabel("Feature 2")
    plt.title(title)
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.show()


def find_optimal_k(data: np.ndarray, max_k: int = 10) -> List[Tuple[int, float]]:
    inertias = []

    for k in range(1, max_k + 1):
        kmeans = KMeans(k=k)
        kmeans.fit(data)
        inertias.append((k, kmeans.inertia(data)))

    return inertias


def main():
    data, true_labels = generate_sample_data(n_samples=300, n_features=2, n_clusters=3)

    kmeans = KMeans(k=3, max_iterations=100)
    kmeans.fit(data)

    predicted_labels = kmeans.labels

    plot_clusters(
        data, predicted_labels, kmeans.centroids, "K-means Clustering Results"
    )

    inertias = find_optimal_k(data, max_k=10)

    plt.figure(figsize=(10, 6))
    ks, values = zip(*inertias)
    plt.plot(ks, values, "bo-")
    plt.xlabel("Number of clusters (k)")
    plt.ylabel("Inertia")
    plt.title("Elbow Method for Optimal k")
    plt.grid(True, alpha=0.3)
    plt.show()

    print(f"Final inertia: {kmeans.inertia(data):.2f}")
    print(f"Centroids:\n{kmeans.centroids}")


if __name__ == "__main__":
    main()
