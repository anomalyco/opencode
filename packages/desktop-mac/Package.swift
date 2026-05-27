// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "YunPat",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "YunPat", targets: ["YunPat"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle.git", from: "2.6.0"),
    ],
    targets: [
        .executableTarget(
            name: "YunPat",
            dependencies: [
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            path: "YunPat",
            resources: [
                .process("Assets.xcassets"),
            ]
        ),
    ]
)
