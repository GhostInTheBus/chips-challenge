// Chip's Challenge for macOS
// Native AppKit app. Drawing, input, menus, sound and music are native.
// The rules and the file readers are the same engine.js / formats.js the web
// version uses, run through Apple's JavaScriptCore, so both play the same.

import AppKit
import AVFoundation
import JavaScriptCore

// MARK: - Files

enum Store {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let u = base.appendingPathComponent("Chips Challenge", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    static let wanted: Set<String> = ["DAT", "CCL", "EXE", "WAV", "MID"]

    static func gameFiles() -> [String: Data] {
        var out: [String: Data] = [:]
        let items = (try? FileManager.default.contentsOfDirectory(at: support, includingPropertiesForKeys: nil)) ?? []
        for u in items where wanted.contains(u.pathExtension.uppercased()) {
            if let d = try? Data(contentsOf: u) { out[u.lastPathComponent.uppercased()] = d }
        }
        return out
    }

    /// Copy Chip's Challenge files from folders, loose files or zips into Application Support.
    static func importFiles(_ urls: [URL]) -> Int {
        var count = 0
        let fm = FileManager.default
        func take(_ u: URL) {
            let ext = u.pathExtension.uppercased()
            if ext == "ZIP" {
                let tmp = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try? fm.createDirectory(at: tmp, withIntermediateDirectories: true)
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                p.arguments = ["-x", "-k", u.path, tmp.path]
                try? p.run(); p.waitUntilExit()
                walk(tmp, depth: 0)
                try? fm.removeItem(at: tmp)
            } else if wanted.contains(ext) {
                var name = u.lastPathComponent.uppercased()
                if (ext == "DAT" || ext == "CCL") && name != "CHIPS.DAT" {
                    if let d = try? Data(contentsOf: u), d.count > 6, d[0] == 0xAC, d[1] == 0xAA { name = "CHIPS.DAT" } else { return }
                }
                let dest = support.appendingPathComponent(name)
                try? fm.removeItem(at: dest)
                if (try? fm.copyItem(at: u, to: dest)) != nil { count += 1 }
            }
        }
        func walk(_ dir: URL, depth: Int) {
            let items = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey])) ?? []
            for u in items {
                let isDir = (try? u.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDir { if depth < 3 { walk(u, depth: depth + 1) } } else { take(u) }
            }
        }
        for u in urls {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: u.path, isDirectory: &isDir), isDir.boolValue { walk(u, depth: 0) } else { take(u) }
        }
        return count
    }
}

// MARK: - JavaScriptCore bridge

final class Engine {
    let ctx: JSContext
    var bridge: JSValue { ctx.objectForKeyedSubscript("Bridge") }

    init() {
        ctx = JSContext()!
        ctx.exceptionHandler = { _, e in NSLog("engine: %@", e?.toString() ?? "?") }
        for name in ["formats", "engine", "midi", "bridge"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "js"),
                  let src = try? String(contentsOf: url, encoding: .utf8) else { fatalError("missing \(name).js") }
            ctx.evaluateScript(src, withSourceURL: url)
        }
    }

    func bytes(_ data: Data) -> JSValue {
        var exc: JSValueRef?
        let obj = JSObjectMakeTypedArray(ctx.jsGlobalContextRef, kJSTypedArrayTypeUint8Array, data.count, &exc)!
        if let ptr = JSObjectGetTypedArrayBytesPtr(ctx.jsGlobalContextRef, obj, &exc) {
            data.withUnsafeBytes { ptr.copyMemory(from: $0.baseAddress!, byteCount: data.count) }
        }
        return JSValue(jsValueRef: obj, in: ctx)
    }

    func data(_ v: JSValue) -> Data {
        var exc: JSValueRef?
        let obj = v.jsValueRef
        let len = JSObjectGetTypedArrayByteLength(ctx.jsGlobalContextRef, obj, &exc)
        guard len > 0, let ptr = JSObjectGetTypedArrayBytesPtr(ctx.jsGlobalContextRef, obj, &exc) else { return Data() }
        return Data(bytes: ptr, count: len)
    }

    @discardableResult
    func call(_ name: String, _ args: [Any] = []) -> JSValue { bridge.invokeMethod(name, withArguments: args) }
}

// MARK: - Images

func cgImage(rgba: Data, width: Int, height: Int) -> CGImage? {
    guard let provider = CGDataProvider(data: rgba as CFData) else { return nil }
    return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                   space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
}

struct Skin {
    var opaque: [CGImage?] = Array(repeating: nil, count: 0x70)
    var overlay: [CGImage?] = Array(repeating: nil, count: 0x70)
    var panel: CGImage?
    var digits: [CGImage?] = []
    var background: CGImage?
    var ending: CGImage?
    var original = false

    init(atlas: CGImage) {
        for n in 0..<0x70 {
            opaque[n] = atlas.cropping(to: CGRect(x: (n >> 4) * 32, y: (n & 15) * 32, width: 32, height: 32))
            if n >= 0x40 {
                overlay[n] = atlas.cropping(to: CGRect(x: (7 + ((n - 0x40) >> 4)) * 32, y: (n & 15) * 32, width: 32, height: 32))
            }
        }
    }
}

// MARK: - Sound

final class Sound {
    var effects: [Int: AVAudioPlayer] = [:]
    var midiPlayer: AVMIDIPlayer?
    var songs: [Data] = []
    var enabled = UserDefaults.standard.object(forKey: "sound") as? Bool ?? true
    var musicOn = UserDefaults.standard.object(forKey: "music") as? Bool ?? true
    private var currentSong = -1

    static let files = ["BLIP2.WAV", "DOOR.WAV", "BUMMER.WAV", "DITTY1.WAV", "CHIMES.WAV", "OOF3.WAV", "STRIKE.WAV",
                        "CHIMES.WAV", "CLICK3.WAV", "POP2.WAV", "WATER2.WAV", "HIT3.WAV", "TELEPORT.WAV", "CLICK1.WAV", "BELL.WAV"]
    // Stand ins for sounds that were Windows system files, or for free mode.
    static let synth: [Int: [(Double, Double)]] = [
        0: [(880, 0.05), (1320, 0.06)], 1: [(220, 0.08), (330, 0.08)], 2: [(300, 0.15), (200, 0.15), (120, 0.3)],
        3: [(523, 0.1), (659, 0.1), (784, 0.1), (1046, 0.25)], 4: [(784, 0.08), (1046, 0.08), (1318, 0.15)], 5: [(110, 0.07)],
        6: [(400, 0.06), (300, 0.06), (200, 0.12)], 7: [(1046, 0.1)], 8: [(1568, 0.04)], 9: [(660, 0.04), (440, 0.04)],
        10: [(0, 0.25)], 11: [(0, 0.4)], 12: [(300, 0.05), (600, 0.05), (1200, 0.08)], 13: [(2000, 0.02)], 14: [(880, 0.3), (660, 0.5)],
    ]

    func load(files: [String: Data], engine: Engine) {
        effects.removeAll()
        for (i, name) in Sound.files.enumerated() {
            let data = files[name] ?? Sound.wav(Sound.synth[i] ?? [])
            if let p = try? AVAudioPlayer(data: data) { p.prepareToPlay(); effects[i] = p }
        }
        songs = files.keys.filter { $0.hasSuffix(".MID") }.sorted().compactMap { name in
            let v = engine.call("midiForMac", [engine.bytes(files[name]!)])
            let d = engine.data(v)
            return d.isEmpty ? files[name] : d
        }
    }

    func play(_ id: Int) {
        guard enabled, let p = effects[id] else { return }
        p.currentTime = 0
        p.play()
    }

    func music(for level: Int) {
        let idx = songs.isEmpty ? -1 : (level - 1) % songs.count
        if !musicOn || idx < 0 { stopMusic(); return }
        if idx == currentSong, midiPlayer?.isPlaying == true { return }
        stopMusic()
        currentSong = idx
        guard let p = try? AVMIDIPlayer(data: songs[idx], soundBankURL: nil) else { return }
        midiPlayer = p
        p.prepareToPlay()
        loop(p)
    }

    private func loop(_ p: AVMIDIPlayer) {
        p.currentPosition = 0
        p.play { [weak self, weak p] in
            DispatchQueue.main.async { if let self = self, let p = p, self.midiPlayer === p, self.musicOn { self.loop(p) } }
        }
    }

    func stopMusic() { midiPlayer?.stop(); midiPlayer = nil; currentSong = -1 }

    /// Tiny square wave (or noise when freq is 0) WAV in memory.
    static func wav(_ tones: [(Double, Double)]) -> Data {
        let rate = 22050.0
        var samples: [Int16] = []
        for (f, dur) in tones {
            let n = Int(rate * dur)
            for i in 0..<n {
                let env = 1.0 - Double(i) / Double(n)
                let v: Double = f > 0 ? ((Int(Double(i) * f / rate * 2) % 2 == 0) ? 1 : -1) : Double.random(in: -1...1)
                samples.append(Int16(v * env * 6000))
            }
        }
        if samples.isEmpty { samples = [0] }
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + samples.count * 2)); d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate) * 2); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(UInt32(samples.count * 2))
        samples.withUnsafeBytes { d.append(contentsOf: $0) }
        return d
    }
}

// MARK: - Game controller

struct LevelInfo { let number: Int; let title: String; let password: String }

final class Game {
    let engine = Engine()
    let sound = Sound()
    var skin: Skin!
    var files: [String: Data] = [:]
    var sets: [String: [LevelInfo]] = [:]
    var setId = UserDefaults.standard.string(forKey: "set") ?? "cclp1"
    var levelIndex = 0
    var attempts = 0
    enum Mode { case ready, play, paused, dialog }
    var mode: Mode = .ready
    var snap: [Int] = []
    var hint = ""
    weak var view: GameView?
    var timer: Timer?

    var levels: [LevelInfo] { sets[setId] ?? [] }
    var level: LevelInfo? { levels.indices.contains(levelIndex) ? levels[levelIndex] : nil }

    func boot() {
        reload()
        timer = Timer(timeInterval: 0.11, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)
    }

    func reload() {
        files = Store.gameFiles()
        // graphics
        var s: Skin?
        if let exe = files["CHIPS.EXE"], case let r = engine.call("loadGraphics", [engine.bytes(exe)]), r.isBoolean, r.toBool() {
            s = makeSkin(fromExe: true)
        }
        if s == nil, let url = Bundle.main.url(forResource: "tiles-free", withExtension: "png"),
           let img = NSImage(contentsOf: url)?.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            var free = Skin(atlas: img)
            free.panel = Game.freePanel()
            s = free
        }
        skin = s
        // level sets
        sets = [:]
        if let url = Bundle.main.url(forResource: "CCLP1", withExtension: "dat"), let d = try? Data(contentsOf: url) {
            loadSet("cclp1", d)
        }
        if let d = files["CHIPS.DAT"] { loadSet("original", d) }
        if sets[setId] == nil { setId = sets["original"] != nil ? "original" : "cclp1" }
        sound.load(files: files, engine: engine)
        start(index: progress()["current"] as? Int ?? 0)
    }

    private func makeSkin(fromExe: Bool) -> Skin? {
        func img(_ name: String) -> CGImage? {
            let size = (engine.call("gfxSize", [name]).toArray() as? [NSNumber])?.map { $0.intValue } ?? [0, 0]
            guard size[0] > 0 else { return nil }
            let px = engine.data(engine.call("gfxPixels", [name]))
            return cgImage(rgba: px, width: size[0], height: size[1])
        }
        guard let atlas = img("tiles") else { return nil }
        var s = Skin(atlas: atlas)
        s.original = true
        s.panel = img("panel")
        s.background = img("background")
        s.ending = img("ending")
        if let digits = img("digits") {
            s.digits = (0..<24).map { digits.cropping(to: CGRect(x: 0, y: $0 * 23, width: 17, height: 23)) }
        }
        return s
    }

    private func loadSet(_ id: String, _ data: Data) {
        let n = engine.call("loadSet", [id, engine.bytes(data)]).toInt32()
        guard n > 0, let rows = engine.call("levelInfo", [id]).toArray() as? [[Any]] else { return }
        sets[id] = rows.map { LevelInfo(number: ($0[0] as? NSNumber)?.intValue ?? 0, title: $0[1] as? String ?? "", password: $0[2] as? String ?? "") }
    }

    // progress per level set, kept in UserDefaults
    func progress() -> [String: Any] { UserDefaults.standard.dictionary(forKey: "progress." + setId) ?? [:] }
    func saveProgress(_ p: [String: Any]) { UserDefaults.standard.set(p, forKey: "progress." + setId) }

    func canVisit(_ i: Int) -> Bool {
        guard levels.indices.contains(i) else { return false }
        let p = progress()
        let visited = p["visited"] as? [Int] ?? []
        return visited.contains(i) || i <= (p["highest"] as? Int ?? 0)
    }

    func start(index: Int, retry: Bool = false) {
        guard !levels.isEmpty else { return }
        levelIndex = max(0, min(levels.count - 1, index))
        if !retry { attempts = 0 }
        engine.call("start", [setId, levelIndex])
        mode = .ready
        var p = progress()
        p["current"] = levelIndex
        var visited = p["visited"] as? [Int] ?? []
        if !visited.contains(levelIndex) { visited.append(levelIndex) }
        p["visited"] = visited
        p["highest"] = max(p["highest"] as? Int ?? 0, levelIndex)
        saveProgress(p)
        refresh()
        if let l = level { view?.window?.title = "Chip's Challenge - Level \(l.number): \(l.title)" }
        sound.music(for: level?.number ?? 1)
    }

    func refresh() {
        snap = (engine.call("snapshot").toArray() as? [NSNumber])?.map { $0.intValue } ?? []
        hint = engine.call("hint").toString() ?? ""
        view?.needsDisplay = true
    }

    func tick() {
        guard mode == .play else { return }
        engine.call("tick")
        for s in engine.call("sounds").toArray() as? [NSNumber] ?? [] { sound.play(s.intValue) }
        refresh()
        if snap.count > 5 && snap[5] == 1 { mode = .dialog; won() } else if snap.count > 5 && snap[5] == 2 { mode = .dialog; died() }
    }

    func press(_ d: Int) {
        if mode == .ready { mode = .play }
        guard mode == .play else { return }
        engine.call("keyDown", [d])
    }
    func release(_ d: Int) { engine.call("keyUp", [d]) }

    func togglePause() {
        if mode == .play { mode = .paused; sound.stopMusic() } else if mode == .paused { mode = .play; sound.music(for: level?.number ?? 1) }
        view?.needsDisplay = true
    }

    static let deathText = [
        "burned": "Oops! Fire hurts without fire boots.", "drowned": "Oops! Chip can't swim without flippers.",
        "bombed": "Oops! Bombs are bad news.", "squished": "Oops! Look out for moving blocks.",
        "eaten": "Oops! Watch out for creatures.", "time": "Oops! Out of time.",
    ]

    func died() {
        let cause = engine.call("death").toString() ?? ""
        sound.play(cause == "time" ? 14 : 2)
        attempts += 1
        for d in 0..<4 { release(d) }
        alert("Chip's Challenge", Game.deathText[cause] ?? "Oops!", ["OK"]) { _ in self.start(index: self.levelIndex, retry: true) }
    }

    func won() {
        sound.play(3)
        for d in 0..<4 { release(d) }
        let timeLeft = max(0, snap[3])
        let sc = engine.call("score", [level?.number ?? 0, timeLeft, attempts]).toArray() as? [NSNumber] ?? [0, 0, 0]
        var p = progress()
        var scores = p["scores"] as? [String: Int] ?? [:]
        var best = p["best"] as? [String: Int] ?? [:]
        let key = String(levelIndex)
        let prev = scores[key] ?? 0
        if sc[2].intValue > prev { scores[key] = sc[2].intValue }
        if snap[3] >= 0, timeLeft > (best[key] ?? -1) { best[key] = timeLeft }
        p["scores"] = scores; p["best"] = best
        p["highest"] = max(p["highest"] as? Int ?? 0, levelIndex + 1)
        saveProgress(p)
        let total = scores.values.reduce(0, +)
        var msg = "Time bonus: \(sc[0])\nLevel bonus: \(sc[1])\nLevel score: \(sc[2])\nTotal score: \(total)"
        let next = levelIndex + 1
        if levels.indices.contains(next) { msg += "\n\nNext: level \(levels[next].number), password \(levels[next].password)" }
        let isEnd = setId == "original" && level?.number == 144
        alert(isEnd ? "Congratulations!" : "\(level?.title ?? "Level") complete", msg, [levels.indices.contains(next) ? "Onward" : "Done"]) { _ in
            if isEnd { self.showEnding(then: next) } else if self.levels.indices.contains(next) { self.start(index: next) } else { self.mode = .ready }
        }
    }

    func showEnding(then next: Int) {
        let a = NSAlert()
        a.messageText = "The End"
        a.informativeText = "You made it through all the levels. The bonus levels after this one are a little extra."
        if let e = skin.ending { a.icon = NSImage(cgImage: e, size: NSSize(width: 144, height: 144)) }
        a.addButton(withTitle: "Continue")
        a.beginSheetModal(for: view!.window!) { _ in self.start(index: next) }
    }

    func alert(_ title: String, _ text: String, _ buttons: [String], done: @escaping (Int) -> Void) {
        guard let w = view?.window else { return }
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        for b in buttons { a.addButton(withTitle: b) }
        a.beginSheetModal(for: w) { r in done(r.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue) }
    }

    // A panel drawn from scratch for free mode (no CHIPS.EXE).
    static func freePanel() -> CGImage? {
        let w = 154, h = 300
        guard let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        c.translateBy(x: 0, y: CGFloat(h)); c.scaleBy(x: 1, y: -1)
        c.setFillColor(gray: 0.75, alpha: 1); c.fill(CGRect(x: 0, y: 0, width: w, height: h))
        c.setFillColor(gray: 1, alpha: 1); c.fill(CGRect(x: 0, y: 0, width: w, height: 2)); c.fill(CGRect(x: 0, y: 0, width: 2, height: h))
        c.setFillColor(gray: 0.5, alpha: 1); c.fill(CGRect(x: 0, y: h - 2, width: w, height: 2)); c.fill(CGRect(x: w - 2, y: 0, width: 2, height: h))
        for y in GameView.counters {
            c.setFillColor(gray: 0.5, alpha: 1); c.fill(CGRect(x: 43, y: y - 6, width: 61, height: 35))
            c.setFillColor(gray: 1, alpha: 1); c.fill(CGRect(x: 45, y: y - 4, width: 59, height: 33))
            c.setFillColor(gray: 0, alpha: 1); c.fill(CGRect(x: 45, y: y, width: 55, height: 29))
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: c, flipped: true)
        let font = NSFont.boldSystemFont(ofSize: 15)
        for (t, y) in [("LEVEL", 10), ("TIME", 72), ("CHIPS", 144), ("LEFT", 162)] {
            let shadow = NSAttributedString(string: t, attributes: [.font: font, .foregroundColor: NSColor.black])
            let s = NSAttributedString(string: t, attributes: [.font: font, .foregroundColor: NSColor(red: 0.88, green: 0, blue: 0, alpha: 1)])
            let x = (CGFloat(w) - s.size().width) / 2
            shadow.draw(at: NSPoint(x: x + 1, y: CGFloat(y) + 1)); s.draw(at: NSPoint(x: x, y: CGFloat(y)))
        }
        NSGraphicsContext.restoreGraphicsState()
        return c.makeImage()
    }
}

// MARK: - View

final class GameView: NSView {
    weak var game: Game?
    static let W: CGFloat = 512, H: CGFloat = 336
    static let boardX: CGFloat = 24, boardY: CGFloat = 18, panelX: CGFloat = 338, panelY: CGFloat = 18
    static let counters = [34, 96, 186]
    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { true }

    override func keyDown(with e: NSEvent) {
        if e.modifierFlags.contains(.command) { super.keyDown(with: e); return }
        if let d = dir(e) { if !e.isARepeat { game?.press(d) } ; return }
        switch e.charactersIgnoringModifiers?.lowercased() {
        case "p": game?.togglePause()
        case "r": if let g = game { g.start(index: g.levelIndex, retry: g.mode != .ready) }
        default: super.keyDown(with: e)
        }
    }
    override func keyUp(with e: NSEvent) { if let d = dir(e) { game?.release(d) } }

    private func dir(_ e: NSEvent) -> Int? {
        switch e.keyCode {
        case 126, 13, 91: return 0   // up, W, keypad 8
        case 123, 0, 86: return 1    // left, A, keypad 4
        case 125, 1, 84: return 2    // down, S, keypad 2
        case 124, 2, 88: return 3    // right, D, keypad 6
        default: return nil
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let g = game, let skin = g.skin, let c = NSGraphicsContext.current?.cgContext else { return }
        NSColor.black.setFill(); bounds.fill()
        let scale = min(bounds.width / GameView.W, bounds.height / GameView.H)
        let ox = (bounds.width - GameView.W * scale) / 2, oy = (bounds.height - GameView.H * scale) / 2
        c.saveGState()
        c.translateBy(x: ox, y: oy); c.scaleBy(x: scale, y: scale)
        c.interpolationQuality = .none
        c.setShouldAntialias(false)

        // background
        if let bg = skin.background {
            var y: CGFloat = 0
            while y < GameView.H { var x: CGFloat = 0; while x < GameView.W { blit(c, bg, x, y, CGFloat(bg.width), CGFloat(bg.height)); x += CGFloat(bg.width) }; y += CGFloat(bg.height) }
        } else {
            c.setFillColor(red: 0.04, green: 0.24, blue: 0.12, alpha: 1); c.fill(CGRect(x: 0, y: 0, width: GameView.W, height: GameView.H))
            c.setStrokeColor(red: 0.12, green: 0.48, blue: 0.25, alpha: 1); c.setLineWidth(2)
            var x: CGFloat = 0
            while x < GameView.W { c.move(to: CGPoint(x: x, y: 0)); c.addLine(to: CGPoint(x: x + 40, y: GameView.H)); x += 64 }
            c.strokePath()
        }
        // board bevel
        bevel(c, GameView.boardX - 4, GameView.boardY - 4, 296, 296)
        let s = g.snap
        if s.count >= 14 + 162 {
            for j in 0..<9 {
                for i in 0..<9 {
                    let top = s[14 + j * 9 + i], bottom = s[14 + 81 + j * 9 + i]
                    tile(c, skin, top, bottom, GameView.boardX + CGFloat(i * 32), GameView.boardY + CGFloat(j * 32))
                }
            }
        }
        // panel
        if let p = skin.panel { blit(c, p, GameView.panelX, GameView.panelY, 154, 300) }
        if s.count > 13 {
            digits(c, skin, GameView.panelX + 47, GameView.panelY + 37, s[4], warn: false)
            digits(c, skin, GameView.panelX + 47, GameView.panelY + 99, s[3] < 0 ? nil : s[3], warn: s[3] >= 0 && s[3] <= 15)
            digits(c, skin, GameView.panelX + 47, GameView.panelY + 189, s[2], warn: s[2] == 0)
            for i in 0..<4 {
                tile(c, skin, s[6 + i] > 0 ? 0x64 + i : 0, 0, GameView.panelX + 13 + CGFloat(i * 32), GameView.panelY + 222)
                tile(c, skin, s[10 + i] > 0 ? 0x68 + i : 0, 0, GameView.panelX + 13 + CGFloat(i * 32), GameView.panelY + 254)
            }
        }
        c.restoreGState()

        // text layers in view coordinates
        func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect { NSRect(x: ox + x * scale, y: oy + y * scale, width: w * scale, height: h * scale) }
        if !g.hint.isEmpty {
            NSColor.black.setFill(); r(GameView.panelX + 8, GameView.panelY + 74, 138, 146).fill()
            NSColor.cyan.setStroke(); NSBezierPath(rect: r(GameView.panelX + 10.5, GameView.panelY + 76.5, 133, 141)).stroke()
            text("Hint: " + g.hint, in: r(GameView.panelX + 14, GameView.panelY + 82, 126, 134), size: 11 * scale, color: .cyan, italic: true)
        }
        if g.mode == .ready, let l = g.level {
            NSColor(white: 0, alpha: 0.72).setFill(); r(GameView.boardX, GameView.boardY + 226, 288, 62).fill()
            text(l.title.isEmpty ? "Level \(l.number)" : l.title, in: r(GameView.boardX, GameView.boardY + 230, 288, 20), size: 15 * scale, color: .yellow, bold: true)
            text("Password: \(l.password.isEmpty ? "----" : l.password)", in: r(GameView.boardX, GameView.boardY + 250, 288, 16), size: 12 * scale, color: .white)
            text("Move to start", in: r(GameView.boardX, GameView.boardY + 266, 288, 16), size: 12 * scale, color: .lightGray)
        }
        if g.mode == .paused {
            NSColor.black.setFill(); r(GameView.boardX, GameView.boardY, 288, 288).fill()
            text("PAUSED", in: r(GameView.boardX, GameView.boardY + 132, 288, 24), size: 18 * scale, color: .white, bold: true)
        }
    }

    private func blit(_ c: CGContext, _ img: CGImage, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
        // the view is flipped, CGImage draws bottom up, so flip each image in place
        c.saveGState()
        c.translateBy(x: x, y: y + h); c.scaleBy(x: 1, y: -1)
        c.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        c.restoreGState()
    }

    private func tile(_ c: CGContext, _ s: Skin, _ top: Int, _ bottom: Int, _ x: CGFloat, _ y: CGFloat) {
        if top >= 0x40 && top < 0x70 {
            if let b = s.opaque[min(max(bottom, 0), 0x6F)] { blit(c, b, x, y, 32, 32) }
            if let o = s.overlay[top] { blit(c, o, x, y, 32, 32) }
        } else if let t = s.opaque[min(max(top, 0), 0x6F)] { blit(c, t, x, y, 32, 32) }
    }

    private func bevel(_ c: CGContext, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
        c.setFillColor(gray: 0.5, alpha: 1); c.fill(CGRect(x: x, y: y, width: w, height: 2)); c.fill(CGRect(x: x, y: y, width: 2, height: h))
        c.setFillColor(gray: 1, alpha: 1); c.fill(CGRect(x: x, y: y + h - 2, width: w, height: 2)); c.fill(CGRect(x: x + w - 2, y: y, width: 2, height: h))
    }

    private func digits(_ c: CGContext, _ s: Skin, _ x: CGFloat, _ y: CGFloat, _ value: Int?, warn: Bool) {
        let str: [Character] = value == nil ? ["-", "-", "-"] : Array(String(format: "%3d", max(0, min(999, value!))))
        for (i, ch) in str.enumerated() {
            if s.digits.count == 24 {
                var gidx = ch == "-" ? 0 : ch == " " ? 1 : 11 - Int(String(ch))!
                if !warn { gidx += 12 }
                if let img = s.digits[gidx] { blit(c, img, x + CGFloat(i * 17), y, 17, 23) }
            } else if ch != " " {
                c.saveGState()
                NSGraphicsContext.saveGraphicsState()
                let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: 20, weight: .bold),
                                                            .foregroundColor: warn ? NSColor.yellow : NSColor.green]
                NSAttributedString(string: String(ch), attributes: attrs).draw(at: NSPoint(x: x + CGFloat(i * 17) + 2, y: y))
                NSGraphicsContext.restoreGraphicsState()
                c.restoreGState()
            }
        }
    }

    private func text(_ s: String, in rect: NSRect, size: CGFloat, color: NSColor, bold: Bool = false, italic: Bool = false) {
        let p = NSMutableParagraphStyle(); p.alignment = .center
        var font = bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size)
        if italic { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
        NSAttributedString(string: s, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: p]).draw(in: rect)
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation {
    var window: NSWindow!
    let game = Game()
    var soundItem: NSMenuItem!, musicItem: NSMenuItem!, originalItem: NSMenuItem!, cclpItem: NSMenuItem!

    func applicationDidFinishLaunching(_ n: Notification) {
        let view = GameView(frame: NSRect(x: 0, y: 0, width: 1024, height: 672))
        view.game = game
        game.view = view
        window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Chip's Challenge"
        window.contentView = view
        window.contentAspectRatio = NSSize(width: 512, height: 336)
        window.contentMinSize = NSSize(width: 512, height: 336)
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("main")
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(view)
        buildMenu()
        game.boot()
        syncMenu()
        if game.sets["original"] == nil {
            game.alert("Welcome", "You're playing CCLP1, 149 free levels made by the Chip's Challenge community.\n\nTo play the original 1992 levels with the original graphics and sounds, choose File > Load Game Files and pick your copy of Chip's Challenge (the folder, or the zip).", ["OK"]) { _ in self.game.mode = .ready }
        }
        NSApp.activate(ignoringOtherApps: true)
        debugHooks()
    }

    /// Test hooks, used to verify builds and make screenshots without screen recording:
    ///   CC_SET=original|cclp1  CC_LEVEL=<index>  CC_MOVES="UUDLR..." (one move per 0.25s, '.' waits)
    ///   CC_SNAPSHOT=/path.png  write the window contents after the moves, CC_QUIT=1 quit after.
    func debugHooks() {
        let env = ProcessInfo.processInfo.environment
        guard env["CC_SNAPSHOT"] != nil || env["CC_MOVES"] != nil else { return }
        FileHandle.standardError.write("debugHooks: set=\(game.setId) levels=\(game.levels.count)\n".data(using: .utf8)!)
        if let a = window.attachedSheet { window.endSheet(a) }
        if let s = env["CC_SET"], game.sets[s] != nil { game.setId = s }
        if let l = env["CC_LEVEL"].flatMap(Int.init) { game.start(index: l) }
        let moves = Array(env["CC_MOVES"] ?? "")
        var i = 0
        func step() {
            if i < moves.count {
                let ch = moves[i]; i += 1
                if let d = ["U": 0, "L": 1, "D": 2, "R": 3][ch] {
                    if env["CC_TRACE"] != nil { FileHandle.standardError.write("\(ch) before \(self.game.engine.call("debug").toString() ?? "") mode=\(self.game.mode)\n".data(using: .utf8)!) }
                    game.press(d)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { self.game.release(d) }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { step() }
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                FileHandle.standardError.write("debugHooks: snapshot\n".data(using: .utf8)!)
                if let path = env["CC_SNAPSHOT"], let v = self.window.contentView,
                   let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                    v.cacheDisplay(in: v.bounds, to: rep)
                    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
                    let info = "level=\(self.game.level?.number ?? 0) mode=\(self.game.mode) status=\(self.game.snap.count > 5 ? self.game.snap[5] : -1) chips=\(self.game.snap.count > 2 ? self.game.snap[2] : -1)\n"
                    try? info.write(toFile: path + ".txt", atomically: true, encoding: .utf8)
                }
                if env["CC_QUIT"] == "1" { NSApp.terminate(nil) }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { step() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
    func windowDidResignKey(_ n: Notification) { if game.mode == .play { game.togglePause() } }

    func buildMenu() {
        let main = NSMenu()
        func sub(_ title: String, _ items: [NSMenuItem]) { let m = NSMenu(title: title); items.forEach(m.addItem); let i = NSMenuItem(); i.submenu = m; main.addItem(i) }
        func item(_ t: String, _ a: Selector?, _ k: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: t, action: a, keyEquivalent: k); i.keyEquivalentModifierMask = mods; i.target = self; return i
        }
        let quit = NSMenuItem(title: "Quit Chip's Challenge", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let about = NSMenuItem(title: "About Chip's Challenge", action: #selector(about), keyEquivalent: ""); about.target = self
        sub("Chip's Challenge", [about, .separator(), quit])
        let close = NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        sub("File", [item("Load Game Files…", #selector(loadFiles), "o"), item("Show Game Files in Finder", #selector(reveal)), .separator(), close])
        sub("Game", [item("New Game", #selector(newGame)), item("Pause (P)", #selector(pause)), item("Best Times", #selector(bestTimes))])
        sub("Level", [item("Restart", #selector(restart), "r"), item("Next", #selector(next), "]"), item("Previous", #selector(prev), "["),
                      item("Go To…", #selector(goTo), "g")])
        soundItem = item("Sound Effects", #selector(toggleSound)); musicItem = item("Background Music", #selector(toggleMusic))
        originalItem = item("Original Levels (your CHIPS.DAT)", #selector(useOriginal)); cclpItem = item("CCLP1 (free, built in)", #selector(useCCLP))
        sub("Options", [musicItem, soundItem, .separator(), originalItem, cclpItem])
        let win = NSMenu(title: "Window"); win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        let wi = NSMenuItem(); wi.submenu = win; main.addItem(wi); NSApp.windowsMenu = win
        sub("Help", [item("How To Play", #selector(howTo), "?")])
        NSApp.mainMenu = main
    }

    func syncMenu() {
        soundItem.state = game.sound.enabled ? .on : .off
        musicItem.state = game.sound.musicOn ? .on : .off
        originalItem.state = game.setId == "original" ? .on : .off
        cclpItem.state = game.setId == "cclp1" ? .on : .off
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(useOriginal) { return game.sets["original"] != nil }
        return true
    }

    @objc func about() {
        game.alert("Chip's Challenge", "A clean rebuild of the 1992 Windows version for the Mac, written from the game's file formats and the community disassembly of CHIPS.EXE.\n\nBuilt in levels: CCLP1 by the Chip's Challenge community. The original levels, graphics, sounds and music come from your own copy.\n\nChip's Challenge was created by Chuck Sommerville. Not affiliated with its rights holders.", ["OK"]) { _ in }
    }
    @objc func loadFiles() {
        let p = NSOpenPanel()
        p.canChooseFiles = true; p.canChooseDirectories = true; p.allowsMultipleSelection = true
        p.message = "Choose your Chip's Challenge folder, its zip, or CHIPS.DAT and CHIPS.EXE"
        p.beginSheetModal(for: window) { r in
            guard r == .OK else { return }
            let n = Store.importFiles(p.urls)
            let had = self.game.sets["original"] != nil
            self.game.reload()
            if !had && self.game.sets["original"] != nil { self.game.setId = "original"; UserDefaults.standard.set("original", forKey: "set"); self.game.start(index: self.game.progress()["current"] as? Int ?? 0) }
            self.syncMenu()
            self.game.alert("Game Files", n > 0 ? "Copied \(n) file\(n == 1 ? "" : "s")." + (self.game.skin.original ? " Original graphics are on." : "") : "No Chip's Challenge files found there.", ["OK"]) { _ in self.game.mode = .ready }
        }
    }
    @objc func reveal() { NSWorkspace.shared.activateFileViewerSelecting([Store.support]) }
    @objc func newGame() {
        game.alert("New Game", "Start over at level 1 and forget your scores and saved passwords for this level set?", ["Yes", "No"]) { r in
            if r == 0 { UserDefaults.standard.removeObject(forKey: "progress." + self.game.setId); self.game.start(index: 0) } else { self.game.mode = .ready }
        }
    }
    @objc func pause() { game.togglePause() }
    @objc func restart() { game.start(index: game.levelIndex, retry: game.mode != .ready) }
    @objc func next() { if game.canVisit(game.levelIndex + 1) { game.start(index: game.levelIndex + 1) } else { goTo() } }
    @objc func prev() { if game.levelIndex > 0 { game.start(index: game.levelIndex - 1) } }
    @objc func toggleSound() { game.sound.enabled.toggle(); UserDefaults.standard.set(game.sound.enabled, forKey: "sound"); syncMenu() }
    @objc func toggleMusic() {
        game.sound.musicOn.toggle(); UserDefaults.standard.set(game.sound.musicOn, forKey: "music")
        if game.sound.musicOn { game.sound.music(for: game.level?.number ?? 1) } else { game.sound.stopMusic() }
        syncMenu()
    }
    @objc func useOriginal() { switchSet("original") }
    @objc func useCCLP() { switchSet("cclp1") }
    func switchSet(_ id: String) {
        guard game.sets[id] != nil else { return }
        game.setId = id; UserDefaults.standard.set(id, forKey: "set")
        game.start(index: game.progress()["current"] as? Int ?? 0); syncMenu()
    }
    @objc func goTo() {
        let a = NSAlert()
        a.messageText = "Go To Level"
        a.informativeText = "Levels you have already reached need no password."
        let num = NSTextField(frame: NSRect(x: 0, y: 30, width: 220, height: 24)); num.placeholderString = "Level number"
        let pw = NSTextField(frame: NSRect(x: 0, y: 0, width: 220, height: 24)); pw.placeholderString = "Password"
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 56)); box.addSubview(num); box.addSubview(pw)
        a.accessoryView = box
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        a.window.initialFirstResponder = num
        game.mode = .dialog
        a.beginSheetModal(for: window) { r in
            guard r == .alertFirstButtonReturn else { self.game.mode = .ready; return }
            let n = Int(num.stringValue.trimmingCharacters(in: .whitespaces)) ?? -1
            let p = pw.stringValue.trimmingCharacters(in: .whitespaces).uppercased()
            var i = self.game.levels.firstIndex { $0.number == n } ?? -1
            if i < 0 && !p.isEmpty { i = self.game.levels.firstIndex { $0.password == p } ?? -1 }
            if i >= 0 && (self.game.canVisit(i) || self.game.levels[i].password == p) { self.game.start(index: i) }
            else { self.game.alert("Go To Level", i < 0 ? "No such level." : "That is not the right password.", ["OK"]) { _ in self.game.mode = .ready } }
        }
    }
    @objc func bestTimes() {
        let p = game.progress()
        let scores = p["scores"] as? [String: Int] ?? [:], best = p["best"] as? [String: Int] ?? [:]
        var lines: [String] = []
        for (i, l) in game.levels.enumerated() where scores[String(i)] != nil || best[String(i)] != nil {
            lines.append("\(l.number). \(l.title): \(best[String(i)].map { "\($0)s left" } ?? "-"), \(scores[String(i)] ?? 0) pts")
        }
        game.mode = .dialog
        game.alert("Best Times", lines.isEmpty ? "No levels finished yet in this set." : lines.suffix(30).joined(separator: "\n") + "\n\nTotal score: \(scores.values.reduce(0, +))", ["OK"]) { _ in self.game.mode = .ready }
    }
    @objc func howTo() {
        game.mode = .dialog
        game.alert("How To Play", "Get Chip to the exit. Pick up enough computer chips to open the chip socket first. Keys open doors of their color. Boots let Chip walk on water, fire, ice and force floors. Push blocks into water to make dirt.\n\nArrow keys, WASD or the number pad move Chip. P pauses, R restarts. Cmd ] and Cmd [ move between levels, Cmd G goes to a level by password.", ["OK"]) { _ in self.game.mode = .ready }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
