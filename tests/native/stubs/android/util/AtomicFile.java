package android.util;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** JVM test double for the write operations used by RoadRegionStore. */
public final class AtomicFile {
    private final File destination;
    private final File pending;

    public AtomicFile(File destination) {
        this.destination = destination;
        this.pending = new File(destination.getPath() + ".new");
    }

    public FileOutputStream startWrite() throws IOException {
        return new FileOutputStream(pending);
    }

    public void finishWrite(FileOutputStream stream) throws IOException {
        stream.close();
        Files.move(pending.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
    }

    public void failWrite(FileOutputStream stream) throws IOException {
        try {
            stream.close();
        } finally {
            Files.deleteIfExists(pending.toPath());
        }
    }
}
