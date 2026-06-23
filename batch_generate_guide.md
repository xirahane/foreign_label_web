# batch_generate.py 使用指南

## 功能

批量异物生成脚本：从背景图文件夹中随机选取 X 光背景，自动检测异物生成区域，随机放置异物素材，合成图像并输出 YOLO 格式标注。

## 快速开始

```powershell
python backend/batch_generate.py --bg_dir ./backgrounds --obj_dirs ./masks_by_category/dot ./masks_by_category/ring --output ./output --total 100 --obj_count_min 2 --obj_count_max 10 --viz_boxes
```

## 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--bg_dir` | str | **必填** | 背景图文件夹路径（支持 jpg/png/bmp/webp） |
| `--obj_dirs` | str[] | **必填** | 异物素材文件夹列表，空格分隔多个 |
| `--output` | str | `./output` | 输出根目录 |
| `--total` | int | 100 | 生成图片总张数 |
| `--obj_count_min` | int | 1 | 每张图最少放置异物个数 |
| `--obj_count_max` | int | 5 | 每张图最多放置异物个数 |
| `--scale_min` | int | 50 | 异物缩放最小百分比（%） |
| `--scale_max` | int | 150 | 异物缩放最大百分比（%） |
| `--rotation_min` | int | 0 | 异物旋转最小角度（°） |
| `--rotation_max` | int | 360 | 异物旋转最大角度（°） |
| `--edge_margin` | int | 40 | 异物与生成区域边缘的最小距离（px） |
| `--blend_mode` | str | `direct` | 融合模式：`direct`（直接覆盖）/ `poisson`（亮度匹配） |
| `--bbox_strategy` | str | `tight` | 标注框策略：`tight`（紧贴）/ `expand`（按比例扩张） |
| `--bbox_expand` | int | 10 | 标注框扩张比例（%，`expand` 策略时生效） |
| `--max_dim` | int | 400 | 自动检测区域时的降采样最大边长（越大越精细但越慢） |
| `--viz_boxes` | flag | 关闭 | 开启后输出 `backgrounds_box/` 可视化图像 |

## 输出结构

```
output/
├── images/              # 合成图像（JPEG）
│   ├── 0001.jpg
│   ├── 0002.jpg
│   └── ...
├── labels/              # YOLO 标注文件
│   ├── 0001.txt
│   ├── 0002.txt
│   ├── classes.txt      # 类别文件（内容: 0）
│   └── ...
└── backgrounds_box/     # 检测区域可视化（需 --viz_boxes）
    ├── xxx_box.jpg
    └── ...
```

## 自动检测区域

脚本使用 Otsu 阈值分割 + 形态学闭运算 + PCA 主成分分析，自动检测 X 光图中包装袋/罐头的倾斜生成区域。异物将被限制在此区域内随机放置。

如果背景图已有同名 `.txt` 标注文件，脚本会自动读取并合并到输出标注中。

## 小标注框扩张

面积小于生成区域 0.1% 的标注框会自动以中心等比扩张到该阈值，避免过小的标注框被训练时忽略。

## 使用示例

**基本用法：**
```powershell
python backend/batch_generate.py --bg_dir ./backgrounds --obj_dirs ./objects/条状
```

**完整参数：**
```powershell
python backend/batch_generate.py `
    --bg_dir ./backgrounds `
    --obj_dirs ./objects/点状 ./objects/条状 ./objects/块状 `
    --output ./my_output `
    --total 500 `
    --obj_count_min 2 `
    --obj_count_max 8 `
    --scale_min 30 `
    --scale_max 200 `
    --rotation_min 0 `
    --rotation_max 360 `
    --edge_margin 40 `
    --blend_mode direct `
    --bbox_strategy expand `
    --bbox_expand 15 `
    --viz_boxes
```

**代码集成：**
```python
from batch_generate import batch_generate, GenerationConfig

config = GenerationConfig(
    bg_dir="./backgrounds",
    obj_dirs=["./objects/条状", "./objects/点状"],
    output_dir="./output",
    total_count=200,
    viz_boxes=True,
)
batch_generate(config)
```
