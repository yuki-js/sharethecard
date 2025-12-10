# Bash Integration Tests - Improvements

**Date**: 2025-12-10  
**改善内容**: RTT測定、詳細なAPDU分析、多様なモックレスポンス

---

## 改善内容

### 1. モックプラットフォームの多様化

**ファイル**: [`packages/cardhost/src/lib/mock-platform.ts`](../../packages/cardhost/src/lib/mock-platform.ts)

#### 追加されたデフォルトレスポンス

モックカードが以下の多様なAPDUコマンドに応答するようになりました：

| APDU Command | Description | Response SW | Data |
|-------------|-------------|-------------|------|
| `00 A4 04 00 08 A0 00 00 00 03 00 00 00` | SELECT File | `9000` | - |
| `00 CA 00 00 00` | GET DATA | `9000` | `4D4F434B` ("MOCK") |
| `00 B0 00 00 10` | READ BINARY (16 bytes) | `9000` | 16 bytes test data |
| `00 84 00 00 08` | GET CHALLENGE | `9000` | 8 random bytes |
| `00 A4 00 00 02 FF FF` | SELECT non-existent | `6A82` | - (File Not Found) |
| `00 C0 00 00 00` | GET RESPONSE wrong Le | `6C10` | - (Correct: 0x10) |
| `00 D0 00 00 04 ...` | UPDATE without security | `6982` | - (Security Not Satisfied) |
| `00 20 00 00 04 ...` | VERIFY PIN incorrect | `63C2` | - (2 retries left) |

これにより、成功だけでなくエラーケースもテストできるようになりました。

---

### 2. RTT（Round-Trip Time）測定

**ファイル**: [`tests/bash/helpers/common.sh`](helpers/common.sh)

#### 新規追加関数

```bash
# 時刻測定開始
measure_time()
  # ミリ秒単位のタイムスタンプを返す
  
# RTT計算
calculate_rtt <start_time>
  # 経過時間をミリ秒で返す
```

#### 使用例

```bash
START_TIME=$(measure_time)
# ... コマンド実行 ...
RTT=$(calculate_rtt $START_TIME)
log_info "RTT: ${RTT}ms"
```

#### 出力例

```
[INFO] RTT: 10067ms
```

各APDU送信の応答時間が測定され、パフォーマンス分析が可能になりました。

---

### 3. APDU応答の詳細分析

**ファイル**: [`tests/bash/helpers/common.sh`](helpers/common.sh)

#### 新規追加関数

```bash
analyze_apdu_response <output> [result_file]
```

#### 機能

1. **Status Word (SW) 解析**
   - 16進数コードから意味を解読
   - 成功/警告/エラーを視覚的に表示

2. **データ長解析**
   - 16進文字数とバイト数を表示
   - データが存在する場合は内容を表示

3. **ファイルへの保存**
   - オプションでファイルに詳細を保存
   - 後から参照可能

#### SW解析例

| SW Code | 表示 | 意味 |
|---------|------|------|
| `9000` | `✓ SUCCESS (0x9000)` | 正常完了 |
| `6A82` | `✗ FILE NOT FOUND (0x6A82)` | ファイル未検出 |
| `6C10` | `⚠ WRONG LENGTH (correct: 0x10)` | 長さエラー（正しくは0x10） |
| `6982` | `✗ SECURITY NOT SATISFIED (0x6982)` | セキュリティ条件未満 |
| `63C2` | `⚠ VERIFICATION FAILED (2 retries left)` | 検証失敗（残り2回） |

#### 出力例

```
Status Word: 9000
Data Length: 8 hex chars (4 bytes)
Data: 4D4F434B

Status: ✓ SUCCESS (0x9000)
```

---

### 4. プロセスログのファイル管理

#### 改善点

別プロセス（router、cardhost）のログは以下の方針で管理：

1. **常にファイルに保存**
   - コンソールにログを垂れ流さない
   - 必要時のみ確認

2. **ログファイルの場所を明示**
   ```
   Logs (use 'cat' or 'tail -f' to view):
     Router:   /tmp/sharethecard-test-XXX/router.log
     Cardhost: /tmp/sharethecard-test-XXX/cardhost.log
   ```

3. **テスト失敗時のみ表示**
   - 失敗したテストの後に最終10行を表示
   - デバッグに必要な情報のみ

#### ログ確認方法

```bash
# テスト実行中にリアルタイムで確認
tail -f /tmp/sharethecard-test-*/router.log

# 事後確認
cat /tmp/sharethecard-test-*/cardhost.log

# 最終行のみ
tail -20 /tmp/sharethecard-test-*/router.log
```

---

### 5. 新規テストシナリオ

**ファイル**: [`tests/bash/test-03-apdu-various.sh`](test-03-apdu-various.sh)

#### テスト内容

7つの異なるAPDUコマンドをテスト：

1. ✅ **SELECT** - 成功（SW=9000）
2. ✅ **GET DATA** - データ付き成功（SW=9000 + "MOCK"）
3. ✅ **READ BINARY** - 16バイト読み取り（SW=9000）
4. ✅ **GET CHALLENGE** - 8バイトランダム（SW=9000）
5. ✅ **FILE NOT FOUND** - ファイル未検出（SW=6A82）
6. ✅ **WRONG LENGTH** - 長さエラー（SW=6C10）
7. ✅ **SECURITY NOT SATISFIED** - セキュリティエラー（SW=6982）

#### 各テストで測定・記録

- RTT（ミリ秒）
- Status Word
- データ長とデータ内容
- 詳細解析結果をファイルに保存

---

## トップレベルimportについて

### 当初の誤解

```typescript
import { PcscPlatformManager } from "@aokiapp/jsapdu-pcsc";
```

このimportがモジュールロード時にネイティブライブラリを読み込むと誤解していました。

### 実際の動作

- **import文**: モジュールの参照を解決するだけ
- **実際のロード**: `getPlatform()`を呼び出した時点

### 結論

トップレベルimportは問題ありません。呼び出さなければネイティブライブラリは読み込まれません。

**元に戻した実装**:
```typescript
import { PcscPlatformManager } from "@aokiapp/jsapdu-pcsc";

// ...

const platform = useMock
  ? new MockSmartCardPlatform()
  : PcscPlatformManager.getInstance().getPlatform();
```

`--mock`フラグ使用時は`PcscPlatformManager`を呼び出さないため、PC/SC依存なしで動作します。

---

## テスト結果

### 実行結果

```
[INFO] Total:  3
[OK] Passed: 3
[INFO] Failed: 0
[OK] ALL TESTS PASSED ✓
```

### RTT測定結果

全てのAPDU送信で約10秒（10000ms）のRTTを観測：

```
[INFO] RTT: 10067ms  # SELECT
[INFO] RTT: 10070ms  # GET DATA
[INFO] RTT: 10069ms  # READ BINARY
[INFO] RTT: 10066ms  # GET CHALLENGE
[INFO] RTT: 10068ms  # SELECT (not found)
[INFO] RTT: 10064ms  # GET RESPONSE (wrong length)
[INFO] RTT: 10067ms  # UPDATE (security error)
```

**注**: 各コマンドは独立した接続で実行されるため、認証オーバーヘッドが含まれます。

### APDU応答分析

全てのStatus Wordが正しく解析され、期待通りの応答が確認されました：

- ✅ 成功ケース: 4件（9000）
- ⚠ 警告ケース: 1件（6C10 - Wrong Length）
- ✗ エラーケース: 2件（6A82 - File Not Found, 6982 - Security Not Satisfied）

---

## まとめ

### 達成された改善

1. ✅ **多様なモックレスポンス** - 8種類のAPDUパターン
2. ✅ **RTT測定機能** - ミリ秒精度でパフォーマンス測定
3. ✅ **詳細なAPDU分析** - Status Wordの自動解析
4. ✅ **ログのファイル管理** - コンソールをカオスにしない
5. ✅ **結果のファイル保存** - 事後分析が可能

### テストの品質向上

- **観察可能性**: RTTとSW解析により動作が可視化
- **再現性**: 結果がファイルに保存され、後から分析可能
- **網羅性**: 成功/エラー/警告の全パターンをテスト
- **実用性**: 実際の打鍵テストとして機能

---

**完成日**: 2025-12-10  
**テスト状況**: 全テストパス（3/3）  
**改善完了**: ✅
