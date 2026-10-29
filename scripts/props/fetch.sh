#!/bin/sh
# Download the CC0 street-prop sources into assets-src/props/<asset>/ (ignored by git).
# Every file is pinned by MD5 (from api.polyhaven.com/files/<asset>); a mismatch stops the script.
# Sources, authors and licences are listed in scripts/props/SOURCES.md.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/assets-src/props"
UA="Mozilla/5.0 (hereafter build)"
PH="https://dl.polyhaven.org/file/ph-assets/Models"

fetch() { # fetch <asset> <local path> <md5> <url>
  out="$SRC/$1/$2"
  if [ -f "$out" ] && [ "$(md5 -q "$out" 2>/dev/null || md5sum "$out" | cut -d' ' -f1)" = "$3" ]; then return 0; fi
  mkdir -p "$(dirname "$out")"
  curl -fsSL --retry 3 -A "$UA" "$4" -o "$out"
  got="$(md5 -q "$out" 2>/dev/null || md5sum "$out" | cut -d' ' -f1)"
  if [ "$got" != "$3" ]; then echo "MD5 mismatch for $1/$2: $got != $3" >&2; exit 1; fi
}

# Poly Haven models (CC0), 1K glTF: <asset> <local path> <md5> <path under $PH>.
# The aircon's grille material ships without its RGBA diffuse in the glTF bundle, so that PNG is fetched too.
while read -r asset path sum url; do
  [ -n "$asset" ] || continue
  fetch "$asset" "$path" "$sum" "$PH/$url"
done <<'LIST'
wooden_crate_01 wooden_crate_01_1k.gltf 33df4d2ae00186d4b64e878466c9e22e gltf/1k/wooden_crate_01/wooden_crate_01_1k.gltf
wooden_crate_01 wooden_crate_01.bin 8318f76b0c24b5538ce23051dbcb79a0 gltf/8k/wooden_crate_01/wooden_crate_01.bin
wooden_crate_01 textures/wooden_crate_01_arm_1k.jpg 67c4aeb1154af98f95516b21ef62291c jpg/1k/wooden_crate_01/wooden_crate_01_arm_1k.jpg
wooden_crate_01 textures/wooden_crate_01_diff_1k.jpg 266e0462d06e77c5745f66e89820544f jpg/1k/wooden_crate_01/wooden_crate_01_diff_1k.jpg
wooden_crate_01 textures/wooden_crate_01_nor_gl_1k.jpg e31626a1fcf6f7062c2ffd9fc982b942 jpg/1k/wooden_crate_01/wooden_crate_01_nor_gl_1k.jpg
wooden_military_crate wooden_military_crate_1k.gltf a6dc6b8e8519a115e8481d9a1c9525cf gltf/1k/wooden_military_crate/wooden_military_crate_1k.gltf
wooden_military_crate wooden_military_crate.bin fb5dbf4aed842eb45f2e18e62683d34a gltf/4k/wooden_military_crate/wooden_military_crate.bin
wooden_military_crate textures/wooden_military_crate_arm_1k.jpg b8f165142d290078ffb08b608cec9d48 jpg/1k/wooden_military_crate/wooden_military_crate_arm_1k.jpg
wooden_military_crate textures/wooden_military_crate_diff_1k.jpg 042ee9d280238702cde679ea00bb37ec jpg/1k/wooden_military_crate/wooden_military_crate_diff_1k.jpg
wooden_military_crate textures/wooden_military_crate_nor_gl_1k.jpg 768fcbb54910fbad95abfb6bd90901d3 jpg/1k/wooden_military_crate/wooden_military_crate_nor_gl_1k.jpg
metal_trash_can metal_trash_can_1k.gltf c322802832a61ad7b17711dfbbc52e6b gltf/1k/metal_trash_can/metal_trash_can_1k.gltf
metal_trash_can metal_trash_can.bin fbde1679a66ea644223b97ebc8336a77 gltf/8k/metal_trash_can/metal_trash_can.bin
metal_trash_can textures/metal_trash_can_arm_1k.jpg af676572c13fae2bb584538f03175efc jpg/1k/metal_trash_can/metal_trash_can_arm_1k.jpg
metal_trash_can textures/metal_trash_can_diff_1k.jpg 55d375d8d51b268b6ed8a4308155959c jpg/1k/metal_trash_can/metal_trash_can_diff_1k.jpg
metal_trash_can textures/metal_trash_can_nor_gl_1k.jpg fa6db04e021f6335ae2d9ad501120cae jpg/1k/metal_trash_can/metal_trash_can_nor_gl_1k.jpg
metal_trash_can textures/metal_trash_can_rust_arm_1k.jpg ed9f635917cde411f235d4585c90b310 jpg/1k/metal_trash_can/metal_trash_can_rust_arm_1k.jpg
metal_trash_can textures/metal_trash_can_rust_diff_1k.jpg 8b90447d250cb790ca537748a2b16691 jpg/1k/metal_trash_can/metal_trash_can_rust_diff_1k.jpg
metal_trash_can textures/metal_trash_can_rust_nor_gl_1k.jpg 25187818d1236815d4a34fd743cadc29 jpg/1k/metal_trash_can/metal_trash_can_rust_nor_gl_1k.jpg
barrel_03 barrel_03_1k.gltf 204eec2159a38a1dc4b826ef255f9468 gltf/1k/barrel_03/barrel_03_1k.gltf
barrel_03 barrel_03.bin 6993587e3ef8e0603334e615ab292288 gltf/4k/barrel_03/barrel_03.bin
barrel_03 textures/barrel_03_arm_1k.jpg 3520338e30b4d257745db34848098688 jpg/1k/barrel_03/barrel_03_arm_1k.jpg
barrel_03 textures/barrel_03_diff_1k.jpg 6e77dc1af60c48787fd80dbbcf125040 jpg/1k/barrel_03/barrel_03_diff_1k.jpg
barrel_03 textures/barrel_03_nor_gl_1k.jpg fd181365eb7397d55773987d145f0420 jpg/1k/barrel_03/barrel_03_nor_gl_1k.jpg
cardboard_box_01 cardboard_box_01_1k.gltf 84572b118cc3640acdd9e978869bb3ee gltf/1k/cardboard_box_01/cardboard_box_01_1k.gltf
cardboard_box_01 cardboard_box_01.bin 64bea3a77434981017b8a06da4ccb0df gltf/4k/cardboard_box_01/cardboard_box_01.bin
cardboard_box_01 textures/cardboard_box_01_arm_1k.jpg 39ea452f95d71ec1362e47dff453c706 jpg/1k/cardboard_box_01/cardboard_box_01_arm_1k.jpg
cardboard_box_01 textures/cardboard_box_01_diff_1k.jpg a306e586325d1759ba3225d2b6ad5121 jpg/1k/cardboard_box_01/cardboard_box_01_diff_1k.jpg
cardboard_box_01 textures/cardboard_box_01_nor_gl_1k.jpg 24768abd73f71cfdd7f5be92b18634a7 jpg/1k/cardboard_box_01/cardboard_box_01_nor_gl_1k.jpg
exterior_aircon_unit exterior_aircon_unit_1k.gltf 10beccfb1bf0c973a0729be8970532a9 gltf/1k/exterior_aircon_unit/exterior_aircon_unit_1k.gltf
exterior_aircon_unit exterior_aircon_unit.bin 971c2cfcbc29256d7872eafe74352279 gltf/4k/exterior_aircon_unit/exterior_aircon_unit.bin
exterior_aircon_unit textures/exterior_aircon_unit_01_arm_1k.jpg 9af3805e7371643962ffe6079d547b00 jpg/1k/exterior_aircon_unit/exterior_aircon_unit_01_arm_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_01_diff_1k.jpg 81003ea4afe59ed4dac090791e41f562 jpg/1k/exterior_aircon_unit/exterior_aircon_unit_01_diff_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_01_nor_gl_1k.jpg 244025f2008cbdc8c8680f0c962ed26f jpg/1k/exterior_aircon_unit/exterior_aircon_unit_01_nor_gl_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_01_opacity_1k.jpg f253dbcb057612371dd1b6d37095c6ba jpg/1k/exterior_aircon_unit/exterior_aircon_unit_01_opacity_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_02_diff_1k.png 24f79d95c9b1c5b9525edf67de8acc24 png/1k/exterior_aircon_unit/exterior_aircon_unit_02_diff_1k.png
exterior_aircon_unit textures/exterior_aircon_unit_02_arm_1k.jpg 98b44ba240f832fe4fa94e90d1887c6a jpg/1k/exterior_aircon_unit/exterior_aircon_unit_02_arm_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_02_nor_gl_1k.jpg e00f9c963e9f3dc798d84f7ebcc4185a jpg/1k/exterior_aircon_unit/exterior_aircon_unit_02_nor_gl_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_rusted_01_arm_1k.jpg f1c2653ac0fb58e8641f9076a2af8a67 jpg/1k/exterior_aircon_unit/exterior_aircon_unit_rusted_01_arm_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_rusted_01_diff_1k.jpg 7b9fba8819918dc388c49f05b5522575 jpg/1k/exterior_aircon_unit/exterior_aircon_unit_rusted_01_diff_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_rusted_01_nor_gl_1k.jpg 5b9df77429c9010ea389aef30fd7d460 jpg/1k/exterior_aircon_unit/exterior_aircon_unit_rusted_01_nor_gl_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_rusted_02_arm_1k.jpg 6e2bee1569b55a3b01d18799e942a6af jpg/1k/exterior_aircon_unit/exterior_aircon_unit_rusted_02_arm_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_rusted_02_nor_gl_1k.jpg 53f4890e3c9b9fb2efcd96f3143f579b jpg/1k/exterior_aircon_unit/exterior_aircon_unit_rusted_02_nor_gl_1k.jpg
exterior_aircon_unit textures/exterior_aircon_unit_rusted_02_opacity_1k.jpg 0540ff18330b76e4e55053d5bd21f59e jpg/1k/exterior_aircon_unit/exterior_aircon_unit_rusted_02_opacity_1k.jpg
plastic_crate_02 plastic_crate_02_1k.gltf ab133a1d655e004fa2f22f039e24efbe gltf/1k/plastic_crate_02/plastic_crate_02_1k.gltf
plastic_crate_02 plastic_crate_02.bin a91c131589eae7242c162782cff0290a gltf/4k/plastic_crate_02/plastic_crate_02.bin
plastic_crate_02 textures/plastic_crate_02_arm_1k.jpg 032b8738359d2423f7bf8dd0aa6f3e5b jpg/1k/plastic_crate_02/plastic_crate_02_arm_1k.jpg
plastic_crate_02 textures/plastic_crate_02_diff_1k.jpg 55ddafcf50ffebdb2806e6b863e9b254 jpg/1k/plastic_crate_02/plastic_crate_02_diff_1k.jpg
plastic_crate_02 textures/plastic_crate_02_nor_gl_1k.jpg 3fd1bb590ead064e6b7cf6eb3cd46fa6 jpg/1k/plastic_crate_02/plastic_crate_02_nor_gl_1k.jpg
LIST
echo "Sources downloaded to $SRC"
