# Tra cứu tài khoản thi TN THPT

Website tĩnh dùng cho GitHub Pages để tra cứu tài khoản và mã đăng nhập thi tốt nghiệp THPT.

## Cấu trúc

- `index.html`, `styles.css`, `app.js`: giao diện và logic tra cứu.
- `data/records.json`: dữ liệu đã mã hóa từng hồ sơ.
- `scripts/build-data.mjs`: build dữ liệu mã hóa từ file Excel nguồn.
- `scripts/extract-xls.ps1`: đọc file `.xls` bằng Excel COM ở chế độ chỉ đọc.

File Excel nguồn và `local-access-code.txt` không được commit.

## Build lại dữ liệu

Máy build cần có Microsoft Excel.

```powershell
node scripts/build-data.mjs "C:\Users\Administrator\Downloads\Danh sach tai khoan thi sinh.xls"
```

Nếu muốn dùng mã truy cập tự chọn:

```powershell
$env:ACCESS_CODE="MA-RIENG-CUA-TRUONG"
node scripts/build-data.mjs "C:\Users\Administrator\Downloads\Danh sach tai khoan thi sinh.xls"
Remove-Item Env:\ACCESS_CODE
```

Nếu không đặt `ACCESS_CODE`, script sẽ tạo mã truy cập chung và lưu vào `local-access-code.txt`.

## Chạy local

```powershell
python -m http.server 8080
```

Mở `http://localhost:8080/`.

## Kiểm tra dữ liệu mã hóa

```powershell
node scripts/verify-data.mjs "C:\Users\Administrator\Downloads\Danh sach tai khoan thi sinh.xls"
```

## Triển khai GitHub Pages

Sau khi đăng nhập GitHub CLI:

```powershell
gh auth login
gh repo create tra-cuu-tn-thpt --public --source . --remote origin --push
gh api -X POST repos/:owner/tra-cuu-tn-thpt/pages -f source[branch]=main -f source[path]=/
```

Nếu lệnh bật Pages báo repository đã có Pages hoặc thiếu quyền, vào GitHub repository > Settings > Pages, chọn branch `main` và folder `/`.
