// swift-tools-version:5.9
// dsh-pet-android 的 Swift 试点模块（项目近期唯一的 Swift 部分）
import PackageDescription

let package = Package(
    name: "PetRuntimeClock",
    products: [
        .library(name: "PetRuntimeClock", targets: ["PetRuntimeClock"]),
    ],
    targets: [
        .target(
            name: "PetRuntimeClock",
            swiftSettings: [.define("SKIP")]
        ),
        .testTarget(
            name: "PetRuntimeClockTests",
            dependencies: ["PetRuntimeClock"],
            swiftSettings: [.define("SKIP")]
        ),
    ]
)
