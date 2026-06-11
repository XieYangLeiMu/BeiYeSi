// LHSModule.tsx - 拉丁超立方抽样初始化模块
import React, { useState } from 'react';
import {
  Card, Row, Col, Button, Input, InputNumber, Select, Table, Space, Tag, message,
  Radio, Divider,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, ExperimentOutlined, CloudUploadOutlined,
  DownloadOutlined, ImportOutlined,
} from '@ant-design/icons';
import type {
  ContinuousVariable, CategoricalVariable, DiscreteVariable,
  Constraint, Experiment,
} from './types';

const { Option } = Select;

interface Props {
  experiments: Experiment[];
  onLHSGenerated: (exps: Experiment[]) => void;
  onImportExperiments: (exps: Experiment[]) => void;
  callAPI: (endpoint: string, method: string, data?: any) => Promise<any>;
  loading: boolean;
}

const LHSModule: React.FC<Props> = ({ experiments, onLHSGenerated, onImportExperiments, callAPI, loading }) => {
  // 变量状态
  const [continuousVars, setContinuousVars] = useState<ContinuousVariable[]>([]);
  const [categoricalVars, setCategoricalVars] = useState<CategoricalVariable[]>([]);
  const [discreteVars, setDiscreteVars] = useState<DiscreteVariable[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [nSamples, setNSamples] = useState(20);
  const [encodingMode, setEncodingMode] = useState<'onehot' | 'descriptor'>('onehot');
  const [previewExps, setPreviewExps] = useState<Experiment[]>([]);
  const [newCV, setNewCV] = useState({ name: '', min: 0, max: 100, step: undefined as number | undefined, unit: '' });
  const [newCatV, setNewCatV] = useState({ name: '', options: '' });
  const [newDV, setNewDV] = useState({ name: '', min: 0, max: 10, step: 1 });
  const [newConstraint, setNewConstraint] = useState({ expression: '', description: '' });

  // 添加连续变量
  const addContinuousVar = () => {
    if (!newCV.name.trim()) { message.warning('请输入变量名'); return; }
    setContinuousVars([...continuousVars, { ...newCV, min: Number(newCV.min), max: Number(newCV.max), step: newCV.step ? Number(newCV.step) : undefined }]);
    setNewCV({ name: '', min: 0, max: 100, step: undefined, unit: '' });
  };

  // 添加分类变量
  const addCategoricalVar = () => {
    if (!newCatV.name.trim()) { message.warning('请输入变量名'); return; }
    const opts = newCatV.options.split(',').map((s) => s.trim()).filter(Boolean);
    if (opts.length < 2) { message.warning('至少输入2个选项，用逗号分隔'); return; }
    setCategoricalVars([...categoricalVars, { name: newCatV.name, options: opts, encoding: encodingMode }]);
    setNewCatV({ name: '', options: '' });
  };

  // 添加离散变量
  const addDiscreteVar = () => {
    if (!newDV.name.trim()) { message.warning('请输入变量名'); return; }
    setDiscreteVars([...discreteVars, { ...newDV, min: Number(newDV.min), max: Number(newDV.max), step: Number(newDV.step) }]);
    setNewDV({ name: '', min: 0, max: 10, step: 1 });
  };

  // 添加约束
  const addConstraint = () => {
    if (!newConstraint.expression.trim()) { message.warning('请输入约束表达式'); return; }
    setConstraints([...constraints, { ...newConstraint }]);
    setNewConstraint({ expression: '', description: '' });
  };

  // 插入操作符到表达式
  const insertOp = (op: string) => {
    setNewConstraint({ ...newConstraint, expression: newConstraint.expression + ' ' + op + ' ' });
  };

  // 生成 LHS 初始设计
  const handleGenerate = async () => {
    const totalVars = continuousVars.length + categoricalVars.length + discreteVars.length;
    if (totalVars === 0) { message.warning('请至少定义一个变量'); return; }
    const result = await callAPI('lhs/generate', 'POST', {
      continuousVars, categoricalVars, discreteVars, constraints, nSamples,
    });
    if (result && result.data) {
      const newExps: Experiment[] = result.data.map((e: any, i: number) => ({
        ...e,
        id: previewExps.length + i + 1,
        batch: previewExps.length + i + 1,
        source: 'LHS' as const,
        status: 'pending' as const,
      }));
      setPreviewExps(newExps);
      message.success(`成功生成 ${newExps.length} 组实验方案`);
    }
  };

  // 一键导入至 BO 数据池
  const handleImportToPool = () => {
    if (previewExps.length === 0) { message.warning('没有可导入的实验方案'); return; }
    onLHSGenerated(previewExps);
    setPreviewExps([]);
    message.success(`已导入 ${previewExps.length} 组实验至 BO 数据池`);
  };

  // 导入单个实验至数据池
  const handleImportSingle = (exp: Experiment) => {
    onLHSGenerated([exp]);
    setPreviewExps((prev) => prev.filter((e) => e.id !== exp.id));
    message.success('已导入 1 组实验至数据池');
  };

  // 预览表格列
  const previewColumns = [
    ...continuousVars.map((v) => ({
      title: v.name + (v.unit ? ` (${v.unit})` : ''),
      key: v.name,
      render: (_: any, record: Experiment) => record.variables[v.name] ?? '-',
    })),
    ...categoricalVars.map((v) => ({
      title: v.name,
      key: v.name,
      render: (_: any, record: Experiment) => record.variables[v.name] ?? '-',
    })),
    ...discreteVars.map((v) => ({
      title: v.name,
      key: v.name,
      render: (_: any, record: Experiment) => record.variables[v.name] ?? '-',
    })),
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Experiment) => (
        <Button type="link" size="small" icon={<ImportOutlined />} onClick={() => handleImportSingle(record)}>
          导入数据池
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 标题区 */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a3a5c', margin: 0 }}>
          LHS
          <span style={{ fontWeight: 400, fontSize: 14, color: '#666', marginLeft: 12 }}>
            拉丁超立方抽样初始化模块
          </span>
        </h2>
        <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>规范数据输入 — 定义变量与约束，生成空间填充的初始实验方案</p>
      </div>

      <Row gutter={[16, 16]}>
        {/* 连续变量 */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>连续变量</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
              <Input placeholder="名称" value={newCV.name} onChange={(e) => setNewCV({ ...newCV, name: e.target.value })} style={{ width: 100 }} />
              <InputNumber placeholder="最小值" value={newCV.min} onChange={(v) => setNewCV({ ...newCV, min: v ?? 0 })} style={{ width: 80 }} />
              <InputNumber placeholder="最大值" value={newCV.max} onChange={(v) => setNewCV({ ...newCV, max: v ?? 100 })} style={{ width: 80 }} />
              <InputNumber placeholder="步长" value={newCV.step} onChange={(v) => setNewCV({ ...newCV, step: v ?? undefined })} style={{ width: 70 }} />
              <Input placeholder="单位" value={newCV.unit} onChange={(e) => setNewCV({ ...newCV, unit: e.target.value })} style={{ width: 60 }} />
              <Button icon={<PlusOutlined />} onClick={addContinuousVar}>添加</Button>
            </Space.Compact>
            {continuousVars.map((v, i) => (
              <Tag key={i} closable onClose={() => setContinuousVars(continuousVars.filter((_, j) => j !== i))} style={{ marginBottom: 4 }}>
                {v.name}: [{v.min}, {v.max}]{v.unit ? ` ${v.unit}` : ''}
              </Tag>
            ))}
          </Card>
        </Col>

        {/* 分类变量 */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>分类变量</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
              <Input placeholder="名称" value={newCatV.name} onChange={(e) => setNewCatV({ ...newCatV, name: e.target.value })} style={{ width: 120 }} />
              <Input placeholder="选项 (逗号分隔)" value={newCatV.options} onChange={(e) => setNewCatV({ ...newCatV, options: e.target.value })} style={{ width: 160 }} />
              <Button icon={<PlusOutlined />} onClick={addCategoricalVar}>添加</Button>
            </Space.Compact>
            {categoricalVars.map((v, i) => (
              <Tag key={i} closable onClose={() => setCategoricalVars(categoricalVars.filter((_, j) => j !== i))} style={{ marginBottom: 4 }}>
                {v.name}: [{v.options.join(', ')}]
              </Tag>
            ))}
          </Card>
        </Col>

        {/* 离散/整数变量 */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>离散 / 整数变量</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
              <Input placeholder="名称" value={newDV.name} onChange={(e) => setNewDV({ ...newDV, name: e.target.value })} style={{ width: 100 }} />
              <InputNumber placeholder="最小值" value={newDV.min} onChange={(v) => setNewDV({ ...newDV, min: v ?? 0 })} style={{ width: 80 }} />
              <InputNumber placeholder="最大值" value={newDV.max} onChange={(v) => setNewDV({ ...newDV, max: v ?? 10 })} style={{ width: 80 }} />
              <InputNumber placeholder="步长" value={newDV.step} onChange={(v) => setNewDV({ ...newDV, step: v ?? 1 })} style={{ width: 70 }} />
              <Button icon={<PlusOutlined />} onClick={addDiscreteVar}>添加</Button>
            </Space.Compact>
            {discreteVars.map((v, i) => (
              <Tag key={i} closable onClose={() => setDiscreteVars(discreteVars.filter((_, j) => j !== i))} style={{ marginBottom: 4 }}>
                {v.name}: [{v.min}, {v.max}] step={v.step}
              </Tag>
            ))}
          </Card>
        </Col>

        {/* 进阶选项 */}
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>进阶选项</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Radio.Group value={encodingMode} onChange={(e) => setEncodingMode(e.target.value)}>
                <Radio value="onehot">独热编码 (One-hot)</Radio>
                <Radio value="descriptor">描述符工程 (CSV 上传)</Radio>
              </Radio.Group>
              {encodingMode === 'descriptor' && (
                <div>
                  <Input type="file" accept=".csv" style={{ width: 300 }} disabled />
                  <p style={{ color: '#999', fontSize: 12, marginTop: 4 }}>上传包含分子描述符的 CSV 文件</p>
                </div>
              )}
            </Space>
          </Card>
        </Col>

        {/* 约束条件 */}
        <Col span={24}>
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>约束条件设置</span>}
            style={{ borderColor: '#d9e8f5' }}
          >
            <Row gutter={[8, 8]}>
              <Col>
                <Button size="small" onClick={() => insertOp('+')}>+</Button>
                <Button size="small" onClick={() => insertOp('-')}>-</Button>
                <Button size="small" onClick={() => insertOp('*')}>*</Button>
                <Button size="small" onClick={() => insertOp('/')}>/</Button>
                <Button size="small" onClick={() => insertOp('<=')}>{'<='}</Button>
                <Button size="small" onClick={() => insertOp('>=')}>{'>='}</Button>
                <Button size="small" onClick={() => insertOp('!=')}>{'!='}</Button>
              </Col>
            </Row>
            <Space.Compact style={{ width: '100%', marginTop: 8 }}>
              <Input placeholder="表达式 (如 temperature <= 200)" value={newConstraint.expression}
                onChange={(e) => setNewConstraint({ ...newConstraint, expression: e.target.value })}
                style={{ width: 280 }} />
              <Input placeholder="描述" value={newConstraint.description}
                onChange={(e) => setNewConstraint({ ...newConstraint, description: e.target.value })} />
              <Button icon={<PlusOutlined />} onClick={addConstraint}>添加约束</Button>
            </Space.Compact>
            {constraints.map((c, i) => (
              <Tag key={i} closable onClose={() => setConstraints(constraints.filter((_, j) => j !== i))} style={{ marginTop: 8 }}>
                {c.expression} {c.description ? `(${c.description})` : ''}
              </Tag>
            ))}
          </Card>
        </Col>

        {/* 抽样控制 */}
        <Col span={24}>
          <Card size="small" title={<span style={{ color: '#1a3a5c' }}>抽样控制</span>} style={{ borderColor: '#d9e8f5' }}>
            <Space>
              <span>初始抽样点数:</span>
              <InputNumber min={1} max={500} value={nSamples} onChange={(v) => setNSamples(v ?? 20)} style={{ width: 80 }} />
              <Button type="primary" icon={<ExperimentOutlined />} onClick={handleGenerate} loading={loading}>
                生成初始设计
              </Button>
              <Button icon={<CloudUploadOutlined />} onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const data: Experiment[] = JSON.parse(text);
                    if (Array.isArray(data)) {
                      onImportExperiments(data);
                      message.success(`成功导入 ${data.length} 条实验数据`);
                    } else message.error('文件格式不正确');
                  } catch { message.error('导入失败'); }
                };
                input.click();
              }}>
                导入数据池
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => {
                const allExps = [...experiments, ...previewExps];
                if (allExps.length === 0) { message.warning('没有数据可导出'); return; }
                const blob = new Blob([JSON.stringify(allExps, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `experiments_${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                message.success('数据导出成功');
              }}>
                导出数据
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 预览表格 */}
      {previewExps.length > 0 && (
        <>
          <Divider />
          <Card
            size="small"
            title={<span style={{ color: '#1a3a5c' }}>实验条件预览</span>}
            extra={
              <Button type="primary" icon={<ImportOutlined />} onClick={handleImportToPool}>
                一键全部导入至 BO 数据池
              </Button>
            }
          >
            <Table
              dataSource={previewExps}
              columns={previewColumns.length > 0 ? previewColumns : [{ title: '暂无数据', key: 'empty', render: () => '-' }]}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </Card>
        </>
      )}
    </div>
  );
};

export default LHSModule;
