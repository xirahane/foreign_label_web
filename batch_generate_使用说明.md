# batch_generate.py 使用说明

## 环境要求

- Python 3.8+
- opencv-python, numpy

```powershell
pip install opencv-python numpy
```

## 功能

批量异物生成脚本，从背景图文件夹中随机选取 X 光背景，自动检测异物生成区域，随机放置异物素材，合成图像并输出 YOLO 格式标注。

## 快速开始

```powershell
python batch_generate.py --bg_dir ./backgrounds --obj_dirs ./masks_by_category/dot ./masks_by_category/ring ./masks_by_category/chunk ./masks_by_category/line --output ./output --total 100 --obj_count_max 10 --viz_boxes
```

## 全部参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--bg_dir` | **必填** | 背景图文件夹路径 |
| `--obj_dirs` | **必填** | 异物素材文件夹（可多个，空格分隔） |
| `--output` | `./output` | 输出目录 |
| `--total` | 100 | 生成图片总张数 |
| `--obj_count_min` | 1 | 每张图最少异物数 |
| `--obj_count_max` | 5 | 每张图最多异物数 |
| `--scale_min` | 50 | 异物缩放最小百分比 |
| `--scale_max` | 150 | 异物缩放最大百分比 |
| `--rotation_min` | 0 | 旋转最小角度 |
| `--rotation_max` | 360 | 旋转最大角度 |
| `--edge_margin` | 40 | 边缘留白（像素） |
| `--blend_mode` | `direct` | `direct` 直接覆盖 / `poisson` 亮度匹配 |
| `--bbox_strategy` | `tight` | `tight` 紧贴 / `expand` 扩张 |
| `--bbox_expand` | 10 | 扩张比例（%） |
| `--viz_boxes` | 关闭 | 输出检测区域可视化图像 |

## 输出结构

```
output/
├── images/              # 合成图像
│   ├── 0001.jpg
│   └── ...
├── labels/              # YOLO 标注 + classes.txt
│   ├── 0001.txt
│   ├── classes.txt
│   └── ...
└── backgrounds_box/     # 可视化（需 --viz_boxes）
```

## 完整示例

```powershell
python batch_generate.py `
    --bg_dir ./backgrounds `
    --obj_dirs ./masks_by_category/dot ./masks_by_category/ring `
    --output ./output `
    --total 100 `
    --obj_count_min 2 `
    --obj_count_max 8 `
    --scale_min 30 `
    --scale_max 200 `
    --rotation_min 0 `
    --rotation_max 360 `
    --edge_margin 40 `
    --bbox_strategy expand `
    --bbox_expand 15 `
    --viz_boxes
```

## 代码调用

```python
from batch_generate import batch_generate, GenerationConfig

config = GenerationConfig(
    bg_dir="./backgrounds",
    obj_dirs=["./objects/条状"],
    output_dir="./output",
    total_count=200,
    viz_boxes=True,
)
batch_generate(config)
```

## 注意事项

- 背景图支持 jpg/png/bmp/webp，灰度图自动转为彩色
- 如果背景图有同名 `.txt` 标注文件，会自动合并到输出标注中
- 面积小于生成区域 0.1% 的标注框会自动以中心等比扩张
