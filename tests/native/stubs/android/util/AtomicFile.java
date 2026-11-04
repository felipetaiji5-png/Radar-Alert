package android.util;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Test-only substitute; does not verify Android AtomicFile durability. */
public final class AtomicFile {
    private final File base;
    private final File pending;
    public AtomicFile(File file) {
        base = file;
        pending = new File(file.getPath() + ".new");
    }
    public FileOutputStream startWrite() throws IOException {
        return new FileOutputStream(pending);
    }
    public void finishWrite(FileOutputStream stream) throws IOException {
        stream.close();
        Files.move(pending.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }
    public void failWrite(FileOutputStream stream) {
        try { stream.close(); } catch (IOException ignored) { }
        pending.delete();
    }
}
